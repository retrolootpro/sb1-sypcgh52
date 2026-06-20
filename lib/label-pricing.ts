export type LabelPricedItem = {
  sell_price?: number | null;
  selected_market_value?: number | null;
  price_cib?: number | null;
  price_loose?: number | null;
  price_new?: number | null;
  price_graded?: number | null;
  purchase_price?: number | null;
};

export function labelBasePrice(item: LabelPricedItem) {
  return Number(item.sell_price)
    || Number(item.selected_market_value)
    || Number(item.price_cib)
    || Number(item.price_loose)
    || Number(item.price_new)
    || Number(item.price_graded)
    || Number(item.purchase_price)
    || 0;
}

export function retailLabelPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const whole = Math.floor(value);
  const cents = value - whole;
  if (cents < 0.5) {
    return Math.max(0, whole - 0.01);
  }
  return Math.max(0, whole + 1 - 0.01);
}

export function inventoryLabelPrice(item: LabelPricedItem) {
  return retailLabelPrice(labelBasePrice(item));
}
