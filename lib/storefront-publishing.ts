export type PublishingItem = {
  id: string;
  quantity: number;
  status?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  storefront_shipping_promotion: string;
};

export type PublishingFilter = 'all' | 'live' | 'needs-price' | 'needs-photo' | 'shipping-excluded';

export function isStorefrontStock(item: Pick<PublishingItem, 'quantity' | 'status'>) {
  return item.quantity > 0 && !['sold', 'archived', 'deleted', 'reserved'].includes(item.status || 'available');
}

export function matchesPublishingFilter(item: PublishingItem, livePrices: Record<string, number>, filter: PublishingFilter) {
  if (!isStorefrontStock(item)) return false;
  if (filter === 'live') return livePrices[item.id] > 0;
  if (filter === 'needs-price') return !(livePrices[item.id] > 0);
  if (filter === 'needs-photo') return !item.image_url;
  if (filter === 'shipping-excluded') return item.storefront_shipping_promotion === 'excluded';
  return true;
}

export function parseStorefrontPrice(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) throw new Error('Enter a price with up to two decimal places.');
  const price = Number(trimmed);
  if (!Number.isFinite(price) || price <= 0 || price > 100000) throw new Error('Enter a price greater than $0 and no more than $100,000.');
  return price;
}
