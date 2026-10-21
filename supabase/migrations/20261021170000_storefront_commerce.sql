-- Service-only commerce mutations; staff read their account's requests and orders.
CREATE TABLE public.storefront_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL,
  email text NOT NULL,
  item text NOT NULL,
  platform text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  address jsonb NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','invoiced','paid','fulfilled','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.storefront_orders (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES auth.users(id),
  request_id uuid REFERENCES public.storefront_requests(id),
  kind text NOT NULL CHECK (kind IN ('checkout','invoice')),
  fingerprint text NOT NULL,
  items jsonb NOT NULL CHECK (jsonb_array_length(items) BETWEEN 1 AND 30),
  status text NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','pending','paid','cancelled','shipped','refunded')),
  stripe_id text UNIQUE,
  stripe_customer_id text,
  payment_intent text,
  payment_url text,
  email_sent boolean NOT NULL DEFAULT false,
  shipping_rate text,
  subtotal_cents integer NOT NULL CHECK (subtotal_cents > 0),
  total_cents integer,
  tax_cents integer NOT NULL DEFAULT 0,
  shipping_cents integer NOT NULL DEFAULT 0,
  refunded_cents integer NOT NULL DEFAULT 0,
  customer jsonb,
  tracking text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE UNIQUE INDEX storefront_request_open_invoice ON public.storefront_orders(request_id)
  WHERE request_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX storefront_orders_account_created ON public.storefront_orders(account_id, created_at DESC);
CREATE INDEX storefront_requests_account_created ON public.storefront_requests(account_id, created_at DESC);

CREATE TABLE public.storefront_payment_events (
  id text PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.storefront_orders(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.storefront_rate_limits (
  key text PRIMARY KEY,
  hits integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE public.storefront_cancelled_keys (id uuid PRIMARY KEY);

ALTER TABLE public.storefront_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_cancelled_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storefront_cancelled_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.storefront_cancelled_keys TO service_role;
REVOKE ALL ON public.storefront_requests, public.storefront_orders,
  public.storefront_payment_events, public.storefront_rate_limits FROM anon, authenticated;
GRANT SELECT ON public.storefront_requests, public.storefront_orders TO authenticated;
GRANT ALL ON public.storefront_requests, public.storefront_orders,
  public.storefront_payment_events, public.storefront_rate_limits TO service_role;
CREATE POLICY "Staff read account requests" ON public.storefront_requests FOR SELECT TO authenticated
  USING (account_id = public.current_account_owner_id() AND public.is_account_member(account_id));
CREATE POLICY "Staff read account orders" ON public.storefront_orders FOR SELECT TO authenticated
  USING (account_id = public.current_account_owner_id() AND public.is_account_member(account_id));

CREATE FUNCTION public.storefront_rate_limit(p_key text, p_limit integer, p_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hits integer;
BEGIN
  INSERT INTO storefront_rate_limits(key,hits,expires_at) VALUES (p_key,1,now()+make_interval(secs=>p_seconds))
  ON CONFLICT (key) DO UPDATE SET
    hits = CASE WHEN storefront_rate_limits.expires_at <= now() THEN 1 ELSE storefront_rate_limits.hits+1 END,
    expires_at = CASE WHEN storefront_rate_limits.expires_at <= now() THEN excluded.expires_at ELSE storefront_rate_limits.expires_at END
  RETURNING hits INTO v_hits;
  RETURN v_hits <= p_limit;
END;
$$;

CREATE FUNCTION public.storefront_reserve(
  p_id uuid, p_account uuid, p_kind text, p_request uuid, p_fingerprint text, p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order storefront_orders;
  v_item jsonb;
  v_inventory inventory_items;
  v_snapshot jsonb := '[]'::jsonb;
  v_subtotal integer := 0;
  v_quantity integer;
  v_price integer;
BEGIN
  -- Serializes retries before reading or decrementing stock.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  IF EXISTS (SELECT 1 FROM storefront_cancelled_keys WHERE id=p_id) THEN RAISE EXCEPTION 'Checkout was cancelled'; END IF;
  SELECT * INTO v_order FROM storefront_orders WHERE id=p_id;
  IF FOUND THEN
    IF v_order.account_id <> p_account OR v_order.fingerprint <> p_fingerprint THEN
      RAISE EXCEPTION 'Order key already used for a different cart';
    END IF;
    RETURN to_jsonb(v_order);
  END IF;
  IF p_kind NOT IN ('checkout','invoice') OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Invalid order'; END IF;
  IF p_kind='invoice' THEN
    PERFORM 1 FROM storefront_requests WHERE id=p_request AND account_id=p_account
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
    SELECT * INTO v_inventory FROM inventory_items WHERE id=(v_item->>'id')::uuid
      AND user_id=p_account FOR UPDATE;
    IF NOT FOUND OR coalesce(v_inventory.quantity,0)<v_quantity
      OR coalesce(v_inventory.status,'available') IN ('sold','archived','deleted','reserved')
      THEN RAISE EXCEPTION 'Item is no longer available in the requested quantity'; END IF;
    v_snapshot := v_snapshot || jsonb_build_array(jsonb_build_object(
      'id',v_inventory.id,'title',v_inventory.product_name,'quantity',v_quantity,'unit_amount',v_price,
      'platform',v_inventory.console,'condition',v_inventory.condition,
      'was_enabled',v_inventory.storefront_enabled));
    UPDATE inventory_items SET quantity=quantity-v_quantity WHERE id=v_inventory.id;
    v_subtotal := v_subtotal + v_quantity*v_price;
  END LOOP;
  INSERT INTO storefront_orders(id,account_id,request_id,kind,fingerprint,items,subtotal_cents)
    VALUES(p_id,p_account,p_request,p_kind,p_fingerprint,v_snapshot,v_subtotal) RETURNING * INTO v_order;
  RETURN to_jsonb(v_order);
END;
$$;

CREATE FUNCTION public.storefront_cancel_unstarted(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  IF EXISTS (SELECT 1 FROM storefront_orders WHERE id=p_id) THEN RETURN false; END IF;
  INSERT INTO storefront_cancelled_keys(id) VALUES(p_id) ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;

CREATE FUNCTION public.storefront_apply_payment(
  p_event text, p_order uuid, p_stripe text, p_action text,
  p_total integer DEFAULT 0, p_tax integer DEFAULT 0, p_shipping integer DEFAULT 0,
  p_customer jsonb DEFAULT NULL, p_intent text DEFAULT NULL, p_refunded integer DEFAULT 0
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order storefront_orders;
  v_item jsonb;
  v_delta integer;
BEGIN
  SELECT * INTO v_order FROM storefront_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND OR v_order.stripe_id IS DISTINCT FROM p_stripe THEN RAISE EXCEPTION 'Payment order mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM storefront_payment_events WHERE id=p_event) THEN RETURN; END IF;
  IF p_action='paid' THEN
    IF v_order.status IN ('creating','pending') THEN
      IF p_total <> v_order.subtotal_cents+p_tax+p_shipping OR p_tax<0 OR p_shipping<0
        THEN RAISE EXCEPTION 'Payment amount mismatch'; END IF;
      UPDATE storefront_orders SET status='paid', total_cents=p_total, tax_cents=p_tax,
        shipping_cents=p_shipping,customer=p_customer,payment_intent=p_intent,paid_at=now() WHERE id=p_order;
      INSERT INTO financial_transactions(user_id,date,description,amount,type,category,subcategory,source,platform,reference_id,merchant_name,notes)
        VALUES(v_order.account_id,current_date,'Online order '||p_order::text,(p_total-p_tax)/100.0,'income',
          'Sales','Online','manual','Stripe',p_order::text,'Pixel & Page',
          'Gross cents: '||p_total||'; tax collected cents: '||p_tax||'; shipping cents: '||p_shipping||'; Stripe: '||p_stripe);
      IF v_order.request_id IS NOT NULL THEN
        UPDATE storefront_requests SET status='paid' WHERE id=v_order.request_id;
      END IF;
    ELSIF v_order.status='cancelled' THEN RAISE EXCEPTION 'Cancelled order received payment; manual reconciliation required';
    END IF;
  ELSIF p_action='cancel' AND v_order.status IN ('creating','pending') THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_order.items) ORDER BY value->>'id' LOOP
      UPDATE inventory_items SET quantity=quantity+(v_item->>'quantity')::integer,
        storefront_enabled=CASE WHEN (v_item->>'was_enabled')::boolean THEN true ELSE storefront_enabled END
        WHERE id=(v_item->>'id')::uuid AND user_id=v_order.account_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Reserved inventory was removed; manual reconciliation required'; END IF;
    END LOOP;
    UPDATE storefront_orders SET status='cancelled' WHERE id=p_order;
    IF v_order.request_id IS NOT NULL THEN UPDATE storefront_requests SET status='reviewing' WHERE id=v_order.request_id; END IF;
  ELSIF p_action='refund' THEN
    IF v_order.status NOT IN ('paid','shipped','refunded') THEN RAISE EXCEPTION 'Order is not paid'; END IF;
    IF p_refunded<0 OR p_refunded>v_order.total_cents THEN RAISE EXCEPTION 'Invalid refund'; END IF;
    v_delta := greatest(0,p_refunded-v_order.refunded_cents);
    IF v_delta>0 THEN
      INSERT INTO financial_transactions(user_id,date,description,amount,type,category,subcategory,source,platform,reference_id,merchant_name,notes)
        VALUES(v_order.account_id,current_date,'Online refund '||p_order::text,
          -round(v_delta*(v_order.total_cents-v_order.tax_cents)::numeric/v_order.total_cents)/100.0,
          'refund','Refunds','Online','manual','Stripe',p_order::text,'Pixel & Page',
          'Refund gross cents: '||v_delta||'; inspect returns before manually restocking.');
      UPDATE storefront_orders SET refunded_cents=p_refunded,
        status=CASE WHEN p_refunded=total_cents THEN 'refunded' ELSE status END WHERE id=p_order;
    END IF;
  END IF;
  INSERT INTO storefront_payment_events(id,order_id) VALUES(p_event,p_order);
END;
$$;

CREATE FUNCTION public.storefront_ship(p_id uuid,p_account uuid,p_tracking text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request uuid;
BEGIN
  IF length(trim(p_tracking)) NOT BETWEEN 3 AND 200 THEN RAISE EXCEPTION 'Tracking is required'; END IF;
  UPDATE storefront_orders SET status='shipped',tracking=trim(p_tracking)
    WHERE id=p_id AND account_id=p_account AND status='paid' RETURNING request_id INTO v_request;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only paid orders can be marked shipped'; END IF;
  IF v_request IS NOT NULL THEN UPDATE storefront_requests SET status='fulfilled' WHERE id=v_request; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.storefront_rate_limit(text,integer,integer),
  public.storefront_ship(uuid,uuid,text),
  public.storefront_cancel_unstarted(uuid),
  public.storefront_reserve(uuid,uuid,text,uuid,text,jsonb),
  public.storefront_apply_payment(text,uuid,text,text,integer,integer,integer,jsonb,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_rate_limit(text,integer,integer),
  public.storefront_ship(uuid,uuid,text),
  public.storefront_cancel_unstarted(uuid),
  public.storefront_reserve(uuid,uuid,text,uuid,text,jsonb),
  public.storefront_apply_payment(text,uuid,text,text,integer,integer,integer,jsonb,text,integer) TO service_role;
