export type PrepQueue = 'in_progress' | 'ready' | 'listed' | 'sold' | 'lots';
type PrepRecord = {
  status?: string | null; sold_at?: string | null; quantity: number;
  on_rack_at?: string | null; listed_ebay_at?: string | null;
  listed_amazon_at?: string | null; listed_whatnot_at?: string | null;
};

export function matchesPrepQueue(item: PrepRecord, queue: PrepQueue) {
  if (queue === 'lots') return true;
  const sold = item.status === 'sold' || !!item.sold_at;
  if (queue === 'sold') return sold;
  if (sold) return false;
  if (item.quantity <= 0 || ['reserved', 'archived', 'deleted'].includes(item.status || 'available')) return false;
  const listed = !!(item.listed_ebay_at || item.listed_amazon_at || item.listed_whatnot_at);
  if (queue === 'listed') return listed;
  if (queue === 'ready') return !!item.on_rack_at && !listed;
  if (queue === 'in_progress') return !item.on_rack_at && !listed;
  return true;
}

export function prepSalePrice(raw: string) {
  const value = raw.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter a nonnegative sale price with up to two decimals.');
  const price = Number(value);
  if (!Number.isFinite(price) || price > 100000) throw new Error('Sale price must be no more than $100,000.');
  return price;
}
