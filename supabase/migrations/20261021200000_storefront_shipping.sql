-- Configuration and order snapshots only: no stock, pricing or finance mutations.
ALTER TABLE public.storefront_settings ADD COLUMN shipping_config jsonb;
ALTER TABLE public.storefront_orders ADD COLUMN shipping_quote jsonb;

-- Existing owner-scoped RLS remains in effect; anonymous reads stay prohibited.
REVOKE ALL ON public.storefront_settings FROM anon;

CREATE FUNCTION public.storefront_reserve_shipping(
  p_id uuid, p_account uuid, p_kind text, p_request uuid, p_fingerprint text, p_items jsonb, p_shipping jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order jsonb;
BEGIN
  IF p_shipping IS NULL OR jsonb_typeof(p_shipping) <> 'object' THEN
    RAISE EXCEPTION 'Shipping quote required';
  END IF;
  v_order := public.storefront_reserve(p_id,p_account,p_kind,p_request,p_fingerprint,p_items);
  UPDATE public.storefront_orders SET shipping_quote=p_shipping
    WHERE id=p_id AND shipping_quote IS NULL;
  SELECT to_jsonb(o) INTO v_order FROM public.storefront_orders o WHERE id=p_id;
  RETURN v_order;
END;
$$;
REVOKE ALL ON FUNCTION public.storefront_reserve_shipping(uuid,uuid,text,uuid,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_reserve_shipping(uuid,uuid,text,uuid,text,jsonb,jsonb) TO service_role;
