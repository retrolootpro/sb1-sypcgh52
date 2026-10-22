ALTER TABLE public.storefront_orders
  ADD COLUMN cost_snapshot_version smallint,
  ADD COLUMN accounting_started_at timestamptz,
  ADD COLUMN stripe_fee_cents integer CHECK (stripe_fee_cents IS NULL OR stripe_fee_cents >= 0),
  ADD COLUMN stripe_fee_status text CHECK (stripe_fee_status IS NULL OR stripe_fee_status IN ('pending', 'recorded'));

ALTER TABLE public.storefront_labels
  ADD COLUMN actual_amount_cents integer CHECK (actual_amount_cents IS NULL OR actual_amount_cents > 0),
  ADD COLUMN currency text CHECK (currency IS NULL OR currency = 'USD'),
  ADD COLUMN accounting_status text CHECK (accounting_status IS NULL OR accounting_status IN ('pending', 'recorded'));
ALTER TABLE public.storefront_labels ALTER COLUMN accounting_status SET DEFAULT 'pending';
CREATE INDEX storefront_orders_accounting_date
  ON public.storefront_orders(account_id, accounting_started_at, id);
CREATE INDEX storefront_labels_accounting_date
  ON public.storefront_labels(account_id, status, accounting_status, created_at, id);

CREATE FUNCTION public.storefront_pending_label_accounting(p_start timestamptz, p_end timestamptz)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account uuid;
BEGIN
  v_account := public.current_account_owner_id();
  IF auth.uid() IS NULL OR v_account IS NULL OR NOT public.is_account_member(v_account)
    THEN RAISE EXCEPTION 'Active company membership required'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start THEN RAISE EXCEPTION 'Invalid reporting period'; END IF;
  RETURN (SELECT count(*) FROM public.storefront_labels
    WHERE account_id=v_account AND status='success' AND accounting_status='pending'
      AND created_at>=p_start AND created_at<p_end);
END;
$$;
REVOKE ALL ON FUNCTION public.storefront_pending_label_accounting(timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storefront_pending_label_accounting(timestamptz,timestamptz) TO authenticated, service_role;

CREATE TABLE public.storefront_finance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.storefront_orders(id),
  account_id uuid NOT NULL REFERENCES auth.users(id),
  kind text NOT NULL CHECK (kind IN ('stripe_fee', 'postage')),
  provider_reference text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  transaction_id uuid REFERENCES public.financial_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, provider_reference)
);
ALTER TABLE public.storefront_finance_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storefront_finance_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.storefront_finance_events TO service_role;

CREATE OR REPLACE FUNCTION public.storefront_reserve(
  p_id uuid, p_account uuid, p_kind text, p_request uuid, p_fingerprint text, p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.storefront_orders;
  v_item jsonb;
  v_inventory public.inventory_items;
  v_snapshot jsonb := '[]'::jsonb;
  v_subtotal integer := 0;
  v_quantity integer;
  v_price integer;
  v_unit_cost_cents bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  IF EXISTS (SELECT 1 FROM public.storefront_cancelled_keys WHERE id=p_id) THEN RAISE EXCEPTION 'Checkout was cancelled'; END IF;
  SELECT * INTO v_order FROM public.storefront_orders WHERE id=p_id;
  IF FOUND THEN
    IF v_order.account_id <> p_account OR v_order.fingerprint <> p_fingerprint THEN
      RAISE EXCEPTION 'Order key already used for a different cart';
    END IF;
    RETURN to_jsonb(v_order);
  END IF;
  IF p_kind NOT IN ('checkout','invoice') OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Invalid order'; END IF;
  IF p_kind='invoice' THEN
    PERFORM 1 FROM public.storefront_requests WHERE id=p_request AND account_id=p_account
      AND status IN ('new','reviewing') FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Request is not available for invoicing'; END IF;
  ELSIF p_request IS NOT NULL THEN RAISE EXCEPTION 'Invalid request'; END IF;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_items)) <> jsonb_array_length(p_items)
    THEN RAISE EXCEPTION 'Duplicate items'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'id' LOOP
    v_quantity := (v_item->>'quantity')::integer;
    v_price := (v_item->>'unit_amount')::integer;
    IF v_quantity NOT BETWEEN 1 AND 20 OR v_price NOT BETWEEN 1 AND 10000000
      OR v_quantity IS NULL OR v_price IS NULL THEN RAISE EXCEPTION 'Invalid order amount'; END IF;
    SELECT * INTO v_inventory FROM public.inventory_items WHERE id=(v_item->>'id')::uuid
      AND user_id=p_account FOR UPDATE;
    IF NOT FOUND OR coalesce(v_inventory.quantity,0)<v_quantity
      OR coalesce(v_inventory.status,'available') IN ('sold','archived','deleted','reserved')
      THEN RAISE EXCEPTION 'Item is no longer available in the requested quantity'; END IF;
    v_unit_cost_cents := CASE WHEN coalesce(v_inventory.purchase_price,0)>0
      AND v_inventory.purchase_price*100<=9007199254740991
      THEN round(v_inventory.purchase_price*100)::bigint ELSE NULL END;
    v_snapshot := v_snapshot || jsonb_build_array(jsonb_build_object(
      'id',v_inventory.id,'title',v_inventory.product_name,'quantity',v_quantity,'unit_amount',v_price,
      'unit_cost_cents',v_unit_cost_cents,'platform',v_inventory.console,'condition',v_inventory.condition,
      'was_enabled',v_inventory.storefront_enabled));
    UPDATE public.inventory_items SET quantity=quantity-v_quantity WHERE id=v_inventory.id;
    v_subtotal := v_subtotal + v_quantity*v_price;
  END LOOP;
  INSERT INTO public.storefront_orders(id,account_id,request_id,kind,fingerprint,items,subtotal_cents,cost_snapshot_version)
    VALUES(p_id,p_account,p_request,p_kind,p_fingerprint,v_snapshot,v_subtotal,1) RETURNING * INTO v_order;
  RETURN to_jsonb(v_order);
END;
$$;

CREATE OR REPLACE FUNCTION public.storefront_reserve_shipping(
  p_id uuid, p_account uuid, p_kind text, p_request uuid, p_fingerprint text, p_items jsonb, p_shipping jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order jsonb;
BEGIN
  IF p_shipping IS NULL OR jsonb_typeof(p_shipping) <> 'object' THEN RAISE EXCEPTION 'Shipping quote required'; END IF;
  v_order := public.storefront_reserve(p_id,p_account,p_kind,p_request,p_fingerprint,p_items);
  UPDATE public.storefront_orders SET shipping_quote=p_shipping WHERE id=p_id AND shipping_quote IS NULL;
  SELECT to_jsonb(o) INTO v_order FROM public.storefront_orders o WHERE id=p_id;
  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.storefront_apply_payment(
  p_event text, p_order uuid, p_stripe text, p_action text,
  p_total integer DEFAULT 0, p_tax integer DEFAULT 0, p_shipping integer DEFAULT 0,
  p_customer jsonb DEFAULT NULL, p_intent text DEFAULT NULL, p_refunded integer DEFAULT 0
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.storefront_orders;
  v_item jsonb;
  v_delta integer;
BEGIN
  SELECT * INTO v_order FROM public.storefront_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND OR v_order.stripe_id IS DISTINCT FROM p_stripe THEN RAISE EXCEPTION 'Payment order mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM public.storefront_payment_events WHERE id=p_event) THEN RETURN; END IF;
  IF p_action='paid' THEN
    IF v_order.status IN ('creating','pending') THEN
      IF p_total <> v_order.subtotal_cents+p_tax+p_shipping OR p_tax<0 OR p_shipping<0
        THEN RAISE EXCEPTION 'Payment amount mismatch'; END IF;
      UPDATE public.storefront_orders SET status='paid', total_cents=p_total, tax_cents=p_tax,
        shipping_cents=p_shipping,customer=p_customer,payment_intent=p_intent,paid_at=now(),
        accounting_started_at=coalesce(accounting_started_at,now()),
        stripe_fee_status=CASE WHEN stripe_fee_status='recorded' THEN 'recorded' ELSE 'pending' END
        WHERE id=p_order;
      INSERT INTO public.financial_transactions(user_id,date,description,amount,type,category,subcategory,source,platform,reference_id,merchant_name,notes)
        VALUES(v_order.account_id,current_date,'Online order '||p_order::text,(p_total-p_tax)/100.0,'income',
          'Sales','Online','manual','Stripe',p_order::text,'Pixel & Page',
          'Gross cents: '||p_total||'; tax collected cents: '||p_tax||'; shipping cents: '||p_shipping||'; Stripe: '||p_stripe);
      IF v_order.request_id IS NOT NULL THEN UPDATE public.storefront_requests SET status='paid' WHERE id=v_order.request_id; END IF;
    ELSIF v_order.status='cancelled' THEN RAISE EXCEPTION 'Cancelled order received payment; manual reconciliation required';
    END IF;
  ELSIF p_action='cancel' AND v_order.status IN ('creating','pending') THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_order.items) ORDER BY value->>'id' LOOP
      UPDATE public.inventory_items SET quantity=quantity+(v_item->>'quantity')::integer,
        storefront_enabled=CASE WHEN (v_item->>'was_enabled')::boolean THEN true ELSE storefront_enabled END
        WHERE id=(v_item->>'id')::uuid AND user_id=v_order.account_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Reserved inventory was removed; manual reconciliation required'; END IF;
    END LOOP;
    UPDATE public.storefront_orders SET status='cancelled' WHERE id=p_order;
    IF v_order.request_id IS NOT NULL THEN UPDATE public.storefront_requests SET status='reviewing' WHERE id=v_order.request_id; END IF;
  ELSIF p_action='refund' THEN
    IF v_order.status NOT IN ('paid','shipped','refunded') THEN RAISE EXCEPTION 'Order is not paid'; END IF;
    IF p_refunded<0 OR p_refunded>v_order.total_cents THEN RAISE EXCEPTION 'Invalid refund'; END IF;
    v_delta := greatest(0,p_refunded-v_order.refunded_cents);
    IF v_delta>0 THEN
      INSERT INTO public.financial_transactions(user_id,date,description,amount,type,category,subcategory,source,platform,reference_id,merchant_name,notes)
        VALUES(v_order.account_id,current_date,'Online refund '||p_order::text,
          -round(v_delta*(v_order.total_cents-v_order.tax_cents)::numeric/v_order.total_cents)/100.0,
          'refund','Refunds','Online','manual','Stripe',p_order::text,'Pixel & Page',
          'Refund gross cents: '||v_delta||'; inspect returns before manually restocking.');
      UPDATE public.storefront_orders SET refunded_cents=p_refunded,
        status=CASE WHEN p_refunded=total_cents THEN 'refunded' ELSE status END WHERE id=p_order;
    END IF;
  END IF;
  INSERT INTO public.storefront_payment_events(id,order_id) VALUES(p_event,p_order);
END;
$$;

CREATE FUNCTION public.storefront_record_stripe_fee(
  p_order uuid, p_charge text, p_intent text, p_amount_cents integer, p_date date
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.storefront_orders;
  v_event public.storefront_finance_events;
  v_event_id uuid;
  v_transaction_id uuid;
BEGIN
  IF p_charge !~ '^ch_[A-Za-z0-9]+$' OR p_intent !~ '^pi_[A-Za-z0-9]+$'
    OR p_amount_cents < 0 OR p_date IS NULL THEN RAISE EXCEPTION 'Invalid Stripe fee reconciliation'; END IF;
  SELECT * INTO v_order FROM public.storefront_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND OR v_order.status NOT IN ('pending','paid','shipped','refunded')
    OR (v_order.payment_intent IS NOT NULL AND v_order.payment_intent IS DISTINCT FROM p_intent)
    THEN RAISE EXCEPTION 'Stripe fee does not match an active storefront order'; END IF;
  UPDATE public.storefront_orders SET payment_intent=p_intent,
    accounting_started_at=coalesce(accounting_started_at,now()),
    stripe_fee_status=CASE WHEN stripe_fee_status='recorded' THEN 'recorded' ELSE 'pending' END
    WHERE id=p_order AND payment_intent IS NULL;
  UPDATE public.storefront_orders SET accounting_started_at=coalesce(accounting_started_at,now()),
    stripe_fee_status=CASE WHEN stripe_fee_status='recorded' THEN 'recorded' ELSE 'pending' END
    WHERE id=p_order AND payment_intent=p_intent;
  INSERT INTO public.storefront_finance_events(order_id,account_id,kind,provider_reference,amount_cents)
    VALUES(p_order,v_order.account_id,'stripe_fee',p_charge,p_amount_cents)
    ON CONFLICT (kind,provider_reference) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    SELECT * INTO v_event FROM public.storefront_finance_events WHERE kind='stripe_fee' AND provider_reference=p_charge;
    IF v_event.order_id<>p_order OR v_event.account_id<>v_order.account_id OR v_event.amount_cents<>p_amount_cents
      THEN RAISE EXCEPTION 'Stripe fee reference was already used with different details'; END IF;
    v_transaction_id := v_event.transaction_id;
  ELSE
    IF p_amount_cents > 0 THEN
      INSERT INTO public.financial_transactions(user_id,date,description,amount,type,category,subcategory,source,platform,reference_id,merchant_name,notes)
        VALUES(v_order.account_id,p_date,'Stripe processing fee for order '||p_order::text,p_amount_cents/100.0,
          'expense','Payment Processing Fees','Online','manual','Stripe','storefront_stripe_fee_'||p_charge,'Stripe',
          'Actual Stripe balance transaction fee; charge '||p_charge)
        RETURNING id INTO v_transaction_id;
    END IF;
    UPDATE public.storefront_finance_events SET transaction_id=v_transaction_id WHERE id=v_event_id;
  END IF;
  UPDATE public.storefront_orders SET stripe_fee_cents=p_amount_cents,stripe_fee_status='recorded' WHERE id=p_order;
END;
$$;

CREATE FUNCTION public.storefront_record_postage(
  p_label uuid, p_transaction text, p_amount_cents integer, p_date date
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_label public.storefront_labels;
  v_event public.storefront_finance_events;
  v_event_id uuid;
BEGIN
  IF p_transaction !~ '^[a-f0-9]{32}$' OR p_amount_cents <= 0 OR p_date IS NULL
    THEN RAISE EXCEPTION 'Invalid Shippo postage reconciliation'; END IF;
  SELECT * INTO v_label FROM public.storefront_labels WHERE id=p_label FOR UPDATE;
  IF NOT FOUND OR v_label.status<>'success' OR v_label.transaction_id IS DISTINCT FROM p_transaction
    OR v_label.actual_amount_cents IS DISTINCT FROM p_amount_cents OR v_label.currency IS DISTINCT FROM 'USD'
    THEN RAISE EXCEPTION 'Postage cost does not match a confirmed Shippo label'; END IF;
  INSERT INTO public.storefront_finance_events(order_id,account_id,kind,provider_reference,amount_cents)
    VALUES(v_label.order_id,v_label.account_id,'postage',p_transaction,p_amount_cents)
    ON CONFLICT (kind,provider_reference) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    SELECT * INTO v_event FROM public.storefront_finance_events WHERE kind='postage' AND provider_reference=p_transaction;
    IF v_event.order_id<>v_label.order_id OR v_event.account_id<>v_label.account_id OR v_event.amount_cents<>p_amount_cents
      THEN RAISE EXCEPTION 'Shippo label reference was already used with different details'; END IF;
    RETURN;
  END IF;
  INSERT INTO public.financial_transactions(user_id,date,description,amount,type,category,subcategory,source,platform,reference_id,merchant_name,notes)
    VALUES(v_label.account_id,p_date,'Postage for storefront order '||v_label.order_id::text,p_amount_cents/100.0,
      'expense','Shipping','Online','manual','Shippo','storefront_shippo_'||p_transaction,'Shippo',
      'Actual confirmed Shippo label cost; label '||p_label::text)
    RETURNING id INTO v_event.transaction_id;
  UPDATE public.storefront_finance_events SET transaction_id=v_event.transaction_id WHERE id=v_event_id;
  UPDATE public.storefront_labels SET accounting_status='recorded' WHERE id=p_label;
END;
$$;

REVOKE ALL ON FUNCTION public.storefront_record_stripe_fee(uuid,text,text,integer,date),
  public.storefront_record_postage(uuid,text,integer,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_record_stripe_fee(uuid,text,text,integer,date),
  public.storefront_record_postage(uuid,text,integer,date) TO service_role;
