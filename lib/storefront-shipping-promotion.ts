export type ShippingPromotionMode = 'eligible' | 'free' | 'excluded';
export const FREE_SHIPPING_MAXIMUM_COST = 800;
export const FREE_SHIPPING_PERCENT = 15;

export function shippingAllowance(value: number) {
  return Math.min(FREE_SHIPPING_MAXIMUM_COST, Math.floor(value * FREE_SHIPPING_PERCENT / 100));
}

export function shippingPromotion(costs: number[], packages: { value: number; mode: ShippingPromotionMode }[]) {
  if (costs.length !== packages.length || !costs.length) throw new Error('Shipping packages and costs must match.');
  const cost = costs.reduce((sum, amount) => sum + amount, 0);
  const value = packages.reduce((sum, pack) => sum + (pack.mode === 'excluded' ? 0 : pack.value), 0);
  const wholeOrder = value > 0 && cost <= shippingAllowance(value)
    && packages.every(pack => pack.mode !== 'excluded');
  const promotionalValue = value;
  const promotionalCost = costs.reduce((sum, amount, index) => sum + (packages[index].mode !== 'excluded' ? amount : 0), 0);
  // The cap applies to the combined subsidy, not independently to every parcel.
  const itemOffer = promotionalValue > 0 && promotionalCost <= shippingAllowance(promotionalValue);
  const discount = wholeOrder ? cost : itemOffer ? promotionalCost : 0;
  const goal = cost <= FREE_SHIPPING_MAXIMUM_COST && packages.every(pack => pack.mode !== 'excluded')
    ? Math.ceil(cost * 100 / FREE_SHIPPING_PERCENT) : null;
  return { cost, amount: cost - discount, discount, goal, wholeOrder };
}
