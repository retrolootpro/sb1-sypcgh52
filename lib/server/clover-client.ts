type CloverRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
};

export type CloverItemPayload = {
  name: string;
  price: number;
  sku?: string;
  code?: string;
  hidden?: boolean;
  available?: boolean;
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function normalizeAccessToken(token: string) {
  return token.trim().replace(/^Bearer\s+/i, '');
}

function cloverConfig() {
  return {
    baseUrl: (process.env.CLOVER_BASE_URL || 'https://api.clover.com').replace(/\/$/, ''),
    merchantId: requiredEnv('CLOVER_MERCHANT_ID'),
    accessToken: normalizeAccessToken(requiredEnv('CLOVER_ACCESS_TOKEN')),
  };
}

function safeSummary(data: unknown) {
  if (!data || typeof data !== 'object') return data;
  const copy = { ...(data as Record<string, unknown>) };
  delete copy.access_token;
  delete copy.token;
  return copy;
}

export class CloverApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function cloverRequest<T>(path: string, options: CloverRequestOptions = {}): Promise<T> {
  const config = cloverConfig();
  const response = await fetch(`${config.baseUrl}/v3/merchants/${config.merchantId}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = response.status === 401
      ? 'Clover API 401: check that CLOVER_ACCESS_TOKEN is the raw token only, belongs to CLOVER_MERCHANT_ID, uses the same Clover environment as CLOVER_BASE_URL, and has inventory item permissions.'
      : `Clover API ${response.status}`;
    throw new CloverApiError(message, response.status, safeSummary(data));
  }
  return data as T;
}

export async function createCloverItem(payload: CloverItemPayload) {
  return cloverRequest<{ id: string }>('/items', { method: 'POST', body: payload });
}

export async function updateCloverItem(itemId: string, payload: CloverItemPayload) {
  return cloverRequest<{ id: string }>(`/items/${encodeURIComponent(itemId)}`, { method: 'POST', body: payload });
}

export async function getCloverItem(itemId: string) {
  return cloverRequest<Record<string, unknown>>(`/items/${encodeURIComponent(itemId)}`);
}

export async function findCloverItemBySkuOrBarcode(sku?: string | null, barcode?: string | null) {
  const filters = [sku ? `sku=${encodeURIComponent(sku)}` : '', barcode ? `code=${encodeURIComponent(barcode)}` : ''].filter(Boolean);
  for (const filter of filters) {
    try {
      const result = await cloverRequest<{ elements?: Array<{ id: string }> }>(`/items?filter=${filter}`);
      if (result.elements?.[0]) return result.elements[0];
    } catch {
      // Some Clover accounts/API versions may not support these filters.
    }
  }
  return null;
}

export async function adjustCloverInventoryCount(itemId: string, quantity: number) {
  return cloverRequest<Record<string, unknown>>(`/item_stocks/${encodeURIComponent(itemId)}`, {
    method: 'POST',
    body: { quantity },
  });
}
