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

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  return `${url.protocol}//${url.host}`;
}

function cloverConfig() {
  return {
    baseUrl: normalizeBaseUrl(process.env.CLOVER_BASE_URL || 'https://api.clover.com'),
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
  const normalizedPath = path.startsWith('/') || path === '' ? path : `/${path}`;
  const response = await fetch(`${config.baseUrl}/v3/merchants/${config.merchantId}${normalizedPath}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'RetroLootPro/1.0 (Clover inventory sync)',
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

function merchantHint(merchantId: string) {
  if (merchantId.length <= 8) return merchantId;
  return `${merchantId.slice(0, 4)}...${merchantId.slice(-4)}`;
}

export async function testCloverConnection() {
  const config = cloverConfig();
  const diagnostics = {
    baseUrl: config.baseUrl,
    merchantId: merchantHint(config.merchantId),
    tokenLength: config.accessToken.length,
    probes: [] as Array<{ name: string; ok: boolean; message: string }>,
  };

  try {
    await cloverRequest<Record<string, unknown>>('');
    diagnostics.probes.push({ name: 'merchant', ok: true, message: 'Merchant access confirmed' });
  } catch (error) {
    diagnostics.probes.push({
      name: 'merchant',
      ok: false,
      message: error instanceof Error ? error.message : 'Merchant access failed',
    });
    return { success: false, diagnostics };
  }

  try {
    await cloverRequest<{ elements?: unknown[] }>('/items?limit=1');
    diagnostics.probes.push({ name: 'items_read', ok: true, message: 'Item read permission confirmed' });
  } catch (error) {
    diagnostics.probes.push({
      name: 'items_read',
      ok: false,
      message: error instanceof Error ? error.message : 'Item read permission failed',
    });
    return { success: false, diagnostics };
  }

  return { success: true, diagnostics };
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
  return setCloverInventoryCount(itemId, quantity);
}

export async function getCloverInventoryStock(itemId: string) {
  return cloverRequest<{ quantity?: number; stockCount?: number }>(`/item_stocks/${encodeURIComponent(itemId)}`);
}

export async function setCloverInventoryCount(itemId: string, quantity: number) {
  const safeQuantity = Math.max(0, Number(quantity) || 0);
  try {
    return await cloverRequest<Record<string, unknown>>(`/item_stocks/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      body: { quantity: safeQuantity },
    });
  } catch (error) {
    if (error instanceof CloverApiError && error.status === 404) {
      return createCloverInventoryCount(itemId, safeQuantity);
    }
    throw error;
  }
}

export async function createCloverInventoryCount(itemId: string, quantity: number) {
  const safeQuantity = Math.max(0, Number(quantity) || 0);
  return cloverRequest<Record<string, unknown>>(`/item_stocks/${encodeURIComponent(itemId)}`, {
    method: 'POST',
    body: { quantity: safeQuantity },
  });
}

export async function addCloverInventoryCount(itemId: string, quantity: number) {
  const addedQuantity = Math.max(0, Number(quantity) || 0);
  let currentQuantity = 0;

  try {
    const stock = await getCloverInventoryStock(itemId);
    currentQuantity = Number(stock.quantity ?? stock.stockCount ?? 0) || 0;
    await setCloverInventoryCount(itemId, currentQuantity + addedQuantity);
  } catch (error) {
    if (error instanceof CloverApiError && error.status === 404) {
      await createCloverInventoryCount(itemId, addedQuantity);
    } else {
      throw error;
    }
  }

  return {
    previousQuantity: currentQuantity,
    addedQuantity,
    finalQuantity: currentQuantity + addedQuantity,
  };
}
