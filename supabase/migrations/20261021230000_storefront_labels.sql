-- Fulfillment records only. Label purchases do not change inventory or revenue.
CREATE TABLE public.storefront_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.storefront_orders(id),
  account_id uuid NOT NULL REFERENCES auth.users(id),
  parcel_index integer NOT NULL CHECK (parcel_index BETWEEN 0 AND 9),
  status text NOT NULL DEFAULT 'purchasing' CHECK (status IN ('purchasing','pending','success','error','unknown')),
  rate jsonb NOT NULL,
  parcel jsonb NOT NULL,
  transaction_id text UNIQUE,
  label_url text,
  tracking_number text,
  tracking_url text,
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id,parcel_index)
);
ALTER TABLE public.storefront_labels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storefront_labels FROM anon, authenticated;
GRANT ALL ON public.storefront_labels TO service_role;

CREATE FUNCTION public.storefront_claim_label(
  p_order uuid, p_account uuid, p_index integer, p_rate jsonb, p_parcel jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.storefront_orders; v_label public.storefront_labels;
BEGIN
  SELECT * INTO v_order FROM public.storefront_orders WHERE id=p_order AND account_id=p_account FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'paid' OR v_order.refunded_cents <> 0 THEN
    RAISE EXCEPTION 'Only paid, unrefunded orders can purchase labels';
  END IF;
  IF v_order.shipping_quote IS NULL OR p_index < 0 OR p_index >= (v_order.shipping_quote->>'parcels')::integer OR p_index > 9 THEN
    RAISE EXCEPTION 'Invalid package for this order';
  END IF;
  SELECT * INTO v_label FROM public.storefront_labels WHERE order_id=p_order AND parcel_index=p_index;
  IF FOUND THEN RETURN jsonb_build_object('claimed',false,'label',to_jsonb(v_label)); END IF;
  INSERT INTO public.storefront_labels(order_id,account_id,parcel_index,rate,parcel)
    VALUES(p_order,p_account,p_index,p_rate,p_parcel) RETURNING * INTO v_label;
  RETURN jsonb_build_object('claimed',true,'label',to_jsonb(v_label));
END;
$$;
REVOKE ALL ON FUNCTION public.storefront_claim_label(uuid,uuid,integer,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_claim_label(uuid,uuid,integer,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.storefront_ship(p_id uuid,p_account uuid,p_tracking text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.storefront_orders;
BEGIN
  IF length(trim(p_tracking)) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Tracking is required'; END IF;
  SELECT * INTO v_order FROM storefront_orders WHERE id=p_id AND account_id=p_account FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'paid' OR v_order.refunded_cents <> 0 THEN
    RAISE EXCEPTION 'Only paid, unrefunded orders can be marked shipped';
  END IF;
  IF EXISTS(SELECT 1 FROM storefront_labels WHERE order_id=p_id) AND (
    EXISTS(SELECT 1 FROM storefront_labels WHERE order_id=p_id AND status <> 'success')
    OR (SELECT count(*) FROM storefront_labels WHERE order_id=p_id) <> (v_order.shipping_quote->>'parcels')::integer
  ) THEN RAISE EXCEPTION 'Resolve and complete all package labels before marking shipped'; END IF;
  UPDATE storefront_orders SET status='shipped',tracking=trim(p_tracking) WHERE id=p_id;
  IF v_order.request_id IS NOT NULL THEN UPDATE storefront_requests SET status='fulfilled' WHERE id=v_order.request_id; END IF;
END;
$$;
