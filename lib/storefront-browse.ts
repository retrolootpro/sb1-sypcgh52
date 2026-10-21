export const pageSizes = [24, 48, 96] as const;
export const catalogSorts = ['newest', 'price-low', 'price-high', 'name', 'featured'] as const;
export type BrowseState = {
  category: string;
  platform: string;
  condition: string;
  query: string;
  minPrice: string;
  maxPrice: string;
  saleOnly: boolean;
  sort: typeof catalogSorts[number];
  page: number;
  pageSize: number;
};

export type BrowseProduct = {
  id: string; title: string; category: string; platform: string; condition: string;
  price: number; compare_at_price?: number | null; featured: boolean;
  created_at?: string | null; brand?: string | null;
};

export const defaultBrowse: BrowseState = {
  category: 'All', platform: 'All', condition: 'All', query: '',
  minPrice: '', maxPrice: '', saleOnly: false, sort: 'newest', page: 1, pageSize: 24,
};

export function isOnSale(product: BrowseProduct) {
  return Number(product.compare_at_price) > product.price;
}

function priceParam(value: string | null) {
  return value && /^\d+(\.\d{1,2})?$/.test(value) && Number.isFinite(Number(value)) ? value : '';
}

export function readBrowse(params: URLSearchParams): BrowseState {
  const sort = catalogSorts.find(value => value === params.get('sort')) || defaultBrowse.sort;
  const page = Number(params.get('page'));
  const pageSize = pageSizes.find(value => value === Number(params.get('size'))) || 24;
  return {
    category: params.get('category') || 'All', platform: params.get('platform') || 'All',
    condition: params.get('condition') || 'All', query: params.get('q') || '',
    minPrice: priceParam(params.get('min')), maxPrice: priceParam(params.get('max')),
    saleOnly: params.get('sale') === '1', sort,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1, pageSize,
  };
}

export function browseUrl(state: BrowseState) {
  const params = new URLSearchParams();
  for (const key of ['category', 'platform', 'condition'] as const) {
    if (state[key] !== 'All') params.set(key, state[key]);
  }
  if (state.query) params.set('q', state.query);
  if (state.minPrice) params.set('min', state.minPrice);
  if (state.maxPrice) params.set('max', state.maxPrice);
  if (state.saleOnly) params.set('sale', '1');
  if (state.sort !== defaultBrowse.sort) params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  if (state.pageSize !== 24) params.set('size', String(state.pageSize));
  return `/shop${params.size ? `?${params}` : ''}#catalog`;
}

export function matchesCategory(item: BrowseProduct, category: string) {
  return category === 'All' || item.category === category
    || (category === 'Accessories' && /accessor|controller|headset|cable|adapter|charger|memory card/i.test(`${item.title} ${item.category}`))
    || (category === 'Apparel' && /apparel|hoodie|t-shirt|tee shirt|sweatshirt|clothing/i.test(`${item.title} ${item.category}`));
}

export function browseProducts<T extends BrowseProduct>(products: T[], state: BrowseState) {
  const query = state.query.trim().toLowerCase();
  const rows = products.filter(item => matchesCategory(item, state.category)
    && (state.platform === 'All' || item.platform === state.platform)
    && (state.condition === 'All' || item.condition === state.condition)
    && (!query || `${item.title} ${item.platform} ${item.condition} ${item.brand || ''}`.toLowerCase().includes(query))
    && (!state.minPrice || item.price >= Number(state.minPrice))
    && (!state.maxPrice || item.price <= Number(state.maxPrice))
    && (!state.saleOnly || isOnSale(item)));
  const date = (item: T) => {
    const time = Date.parse(item.created_at || '');
    return Number.isFinite(time) ? time : 0;
  };
  rows.sort((a, b) => {
    const tie = a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id);
    if (state.sort === 'price-low') return a.price - b.price || tie;
    if (state.sort === 'price-high') return b.price - a.price || tie;
    if (state.sort === 'name') return tie;
    if (state.sort === 'featured') return Number(b.featured) - Number(a.featured) || date(b) - date(a) || tie;
    return Number(isOnSale(b)) - Number(isOnSale(a)) || date(b) - date(a) || tie;
  });
  const pageCount = Math.max(1, Math.ceil(rows.length / state.pageSize));
  const page = Math.min(state.page, pageCount);
  const start = (page - 1) * state.pageSize;
  return { total: rows.length, pageCount, page, start, items: rows.slice(start, start + state.pageSize) };
}
