import { supabase } from './supabase';

// ─── Shared types ────────────────────────────────────────────────────────────

export type PricingStatus = 'success' | 'no_match' | 'api_error' | 'config_error' | 'invalid_input';

export type ConditionSource = 'pricecharting_api' | 'pricecharting_web' | 'ebay_90d' | 'ebay_web' | 'cached' | 'none';

export interface ConditionPrice {
  value: number;
  source: ConditionSource;
  sampleCount: number;
}

export interface CanonicalPrices {
  loose: ConditionPrice;
  cib: ConditionPrice;
  new: ConditionPrice;
  graded: ConditionPrice;
}

export interface PcMatch {
  productId: string;
  productName: string;
  platform: string;
  strategy: string;
}

export interface PricingDiagnostics {
  refreshStatus: 'success' | 'partial' | 'failed';
  missingConditions: string[];
  warnings: string[];
  ebayBlocked: boolean;
  pcApiUsed: boolean;
}

export interface CanonicalPricingResult {
  status: 'success' | 'partial' | 'failed' | 'api_error';
  prices: CanonicalPrices;
  pcMatch: PcMatch | null;
  diagnostics: PricingDiagnostics;
  cached: boolean;
  source: string;
  error?: string;
  errorCode?: string;
}

// ─── lookup-pricing (PriceCharting API, used at scan time) ───────────────────

export interface PricingResult {
  status: PricingStatus;
  data?: {
    productName: string;
    console: string;
    loosePrice: number;
    cibPrice: number;
    newPrice: number;
    gradedPrice?: number;
    pcProductId?: string;
    matchedTitle?: string;
    matchedPlatform?: string;
    confidence: number;
    strategy?: string;
    genre?: string;
  };
  error?: string;
  errorCode?: string;
  attemptedQueries?: string[];
}

interface EdgeSuccessResponse {
  success: true;
  pricingStatus: 'matched';
  matchedTitle: string;
  matchedPlatform: string;
  confidence: number;
  strategy: string;
  prices: { loose: number; cib: number; new: number; graded: number };
  raw?: Record<string, unknown>;
}

interface EdgeNoMatchResponse {
  success: true;
  pricingStatus: 'no_match';
  matchedTitle: null;
  matchedPlatform: null;
  confidence: 0;
  strategy: 'none';
  prices: null;
  attemptedQueries?: string[];
}

interface EdgeErrorResponse {
  success: false;
  pricingStatus: 'error';
  errorCode: 'FUNCTION_NOT_FOUND' | 'CONFIG_ERROR' | 'UPSTREAM_API_ERROR' | 'INVALID_INPUT';
  message: string;
}

type EdgeResponse = EdgeSuccessResponse | EdgeNoMatchResponse | EdgeErrorResponse;

export async function getPricingData(
  productName: string,
  platform: string,
  _userId: string,
  forceRefresh = false,
  upc?: string
): Promise<PricingResult> {
  const isDev = process.env.NODE_ENV === 'development';

  try {
    if (!productName?.trim()) {
      return { status: 'invalid_input', error: 'Product name is required' };
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { status: 'api_error', error: 'No active session' };

    if (isDev) console.log(`[Pricing] lookup-pricing: "${productName}" (${platform})`);

    const { data, error } = await supabase.functions.invoke('lookup-pricing', {
      body: {
        productName: productName.trim(),
        platform: platform || 'Unknown',
        forceRefresh,
        ...(upc ? { upc } : {}),
      },
    });

    if (error) {
      console.error('[Pricing] Edge Function error:', error);
      return {
        status: 'api_error',
        error: error.message || 'Failed to invoke pricing function',
        errorCode: error.message?.includes('404') ? 'FUNCTION_NOT_FOUND' : undefined,
      };
    }

    if (!data) return { status: 'api_error', error: 'No response from pricing function' };

    const resp = data as EdgeResponse;

    if (resp.success && resp.pricingStatus === 'matched') {
      const matched = resp as EdgeSuccessResponse;
      if (isDev) {
        console.log(`[Pricing] Match: "${matched.matchedTitle}" (${matched.matchedPlatform}) ${matched.confidence}%`);
        console.log(`[Pricing] Prices: L=$${matched.prices.loose} C=$${matched.prices.cib} N=$${matched.prices.new} G=$${matched.prices.graded}`);
      }
      return {
        status: 'success',
        data: {
          productName: matched.matchedTitle,
          console: matched.matchedPlatform,
          loosePrice: matched.prices.loose,
          cibPrice: matched.prices.cib,
          newPrice: matched.prices.new,
          gradedPrice: matched.prices.graded,
          pcProductId: (matched.raw?.productId as string) || '',
          matchedTitle: matched.matchedTitle,
          matchedPlatform: matched.matchedPlatform,
          confidence: matched.confidence,
          strategy: matched.strategy,
          genre: (matched.raw?.genre as string) || '',
        },
      };
    }

    if (resp.success && resp.pricingStatus === 'no_match') {
      const nm = resp as EdgeNoMatchResponse;
      return { status: 'no_match', error: 'Product not found in PriceCharting', attemptedQueries: nm.attemptedQueries };
    }

    if (!resp.success && resp.pricingStatus === 'error') {
      const er = resp as EdgeErrorResponse;
      let status: PricingStatus = 'api_error';
      if (er.errorCode === 'CONFIG_ERROR') status = 'config_error';
      else if (er.errorCode === 'INVALID_INPUT') status = 'invalid_input';
      return { status, error: er.message, errorCode: er.errorCode };
    }

    return { status: 'api_error', error: 'Unexpected response format' };
  } catch (err) {
    console.error('[Pricing] Exception:', err);
    return { status: 'api_error', error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export function getPricingStatusMessage(result: PricingResult): string {
  switch (result.status) {
    case 'success':       return 'Pricing found';
    case 'no_match':      return 'No PriceCharting match found';
    case 'config_error':  return 'PriceCharting API key not configured';
    case 'invalid_input': return 'Invalid product information';
    case 'api_error':
      return result.errorCode === 'FUNCTION_NOT_FOUND' ? 'Pricing service unavailable' : 'Pricing lookup failed';
    default:              return 'Pricing unavailable';
  }
}

export function shouldBlockItemCreation(_result: PricingResult): boolean {
  return false;
}

export function toDatabaseStatus(result: PricingResult): string {
  switch (result.status) {
    case 'success':       return 'found';
    case 'no_match':      return 'missing';
    case 'config_error':  return 'no_api_key';
    case 'invalid_input':
    case 'api_error':     return 'error';
    default:              return 'pending';
  }
}

// ─── search-market-prices (unified market pricing, used at refresh time) ─────

/** Legacy flat prices shape — kept for backward-compat with non-detail-page callers */
export interface MarketPricingResult {
  status: 'success' | 'config_error' | 'api_error';
  prices?: { loose: number; cib: number; new: number; graded: number };
  sampleCounts?: { loose: number; cib: number; new: number; graded: number };
  source?: string;
  error?: string;
  errorCode?: string;
}

/**
 * Full canonical market pricing call.
 *
 * Pass `upc` and `storedPcProductId` when available so the function can:
 *   1. Skip the expensive title-search step (stored ID → direct fetch)
 *   2. Fall back to UPC exact-match before fuzzy title search
 *
 * Pass `forceRefresh=true` to bypass the 12-hour cache.
 *
 * The function ALWAYS returns per-condition source info so the UI can show
 * "PriceCharting API" vs "eBay (n sales)" vs "No verified data".
 */
export async function getCanonicalPricing(
  productName: string,
  platform: string,
  options: {
    upc?: string | null;
    storedPcProductId?: string | null;
    forceRefresh?: boolean;
  } = {}
): Promise<CanonicalPricingResult> {
  const isDev = process.env.NODE_ENV === 'development';

  try {
    if (shouldUseLocalPricing()) {
      const localResult = await invokeLocalMarketPricing(productName, platform, options);
      if (localResult) return localResult;
    }

    const { data, error } = await supabase.functions.invoke('search-market-prices', {
      body: {
        productName: productName.trim(),
        platform: platform || '',
        upc: options.upc ?? null,
        storedPcProductId: options.storedPcProductId ?? null,
        forceRefresh: options.forceRefresh ?? false,
      },
    });

    if (error) {
      console.error('[Market] Edge function error:', error);
      const fallback = await getPricingData(
        productName,
        platform,
        '',
        true,
        options.upc ?? undefined
      );

      if (fallback.status === 'success' && fallback.data) {
        return pricingResultToCanonical(fallback, [
          `90-day market pricing unavailable: ${error.message}`,
          'Using PriceCharting current values as fallback.',
        ]);
      }

      return {
        status: 'api_error',
        prices: emptyPrices(),
        pcMatch: null,
        diagnostics: failedDiagnostics([
          error.message,
          fallback.error ? `PriceCharting fallback also failed: ${fallback.error}` : 'PriceCharting fallback also failed',
        ]),
        cached: false,
        source: 'none',
        error: error.message,
      };
    }

    if (!data) {
      return {
        status: 'api_error',
        prices: emptyPrices(),
        pcMatch: null,
        diagnostics: failedDiagnostics(['No response from market pricing service']),
        cached: false,
        source: 'none',
        error: 'No response',
      };
    }

    if (!data.success) {
      return {
        status: 'api_error',
        prices: emptyPrices(),
        pcMatch: null,
        diagnostics: failedDiagnostics([data.message ?? 'Unknown error']),
        cached: false,
        source: 'none',
        error: data.message,
        errorCode: data.errorCode,
      };
    }

    const diag: PricingDiagnostics = {
      refreshStatus: data.diagnostics?.refreshStatus ?? 'failed',
      missingConditions: data.diagnostics?.missingConditions ?? [],
      warnings: data.diagnostics?.warnings ?? [],
      ebayBlocked: data.diagnostics?.ebayBlocked ?? false,
      pcApiUsed: data.diagnostics?.pcApiUsed ?? false,
    };

    const status =
      diag.refreshStatus === 'success' ? 'success' :
      diag.refreshStatus === 'partial' ? 'partial' : 'failed';

    if (isDev) {
      const p = data.prices;
      console.log(
        `[Market] Result: L=$${p?.loose?.value}(${p?.loose?.source}) ` +
        `C=$${p?.cib?.value}(${p?.cib?.source}) ` +
        `N=$${p?.new?.value}(${p?.new?.source}) ` +
        `G=$${p?.graded?.value}(${p?.graded?.source})`
      );
      if (diag.warnings.length) console.log('[Market] Warnings:', diag.warnings);
    }

    return {
      status,
      prices: data.prices as CanonicalPrices,
      pcMatch: data.pcMatch ?? null,
      diagnostics: diag,
      cached: data.cached ?? false,
      source: data.prices?.loose?.source ?? 'none',
    };
  } catch (err) {
    console.error('[Market] Exception:', err);
    return {
      status: 'api_error',
      prices: emptyPrices(),
      pcMatch: null,
      diagnostics: failedDiagnostics([err instanceof Error ? err.message : 'Unknown error']),
      cached: false,
      source: 'none',
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/** Backward-compatible wrapper — returns the old flat MarketPricingResult shape */
export async function getMarketPricing(
  productName: string,
  platform: string,
  forceRefresh = false,
  upc?: string | null,
  storedPcProductId?: string | null
): Promise<MarketPricingResult & { canonical?: CanonicalPricingResult }> {
  const result = await getCanonicalPricing(productName, platform, {
    upc,
    storedPcProductId,
    forceRefresh,
  });

  if (result.status === 'api_error') {
    return { status: 'api_error', error: result.error, errorCode: result.errorCode, canonical: result };
  }

  const p = result.prices;
  return {
    status: 'success',
    prices: {
      loose:  p.loose.value,
      cib:    p.cib.value,
      new:    p.new.value,
      graded: p.graded.value,
    },
    sampleCounts: {
      loose:  p.loose.sampleCount,
      cib:    p.cib.sampleCount,
      new:    p.new.sampleCount,
      graded: p.graded.sampleCount,
    },
    source: result.source,
    canonical: result,
  };
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function emptyPrices(): CanonicalPrices {
  const none: ConditionPrice = { value: 0, source: 'none', sampleCount: 0 };
  return { loose: { ...none }, cib: { ...none }, new: { ...none }, graded: { ...none } };
}

function shouldUseLocalPricing(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

async function invokeLocalMarketPricing(
  productName: string,
  platform: string,
  options: {
    upc?: string | null;
    storedPcProductId?: string | null;
    forceRefresh?: boolean;
  }
): Promise<CanonicalPricingResult | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    const response = await fetch('/api/local-market-prices', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        productName: productName.trim(),
        platform: platform || '',
        upc: options.upc ?? null,
        storedPcProductId: options.storedPcProductId ?? null,
        forceRefresh: options.forceRefresh ?? false,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data?.success) {
      return {
        status: 'api_error',
        prices: emptyPrices(),
        pcMatch: null,
        diagnostics: failedDiagnostics([data?.message ?? 'Local pricing endpoint failed']),
        cached: false,
        source: 'none',
        error: data?.message ?? 'Local pricing endpoint failed',
        errorCode: data?.errorCode,
      };
    }

    const diag: PricingDiagnostics = {
      refreshStatus: data.diagnostics?.refreshStatus ?? 'failed',
      missingConditions: data.diagnostics?.missingConditions ?? [],
      warnings: data.diagnostics?.warnings ?? [],
      ebayBlocked: data.diagnostics?.ebayBlocked ?? false,
      pcApiUsed: data.diagnostics?.pcApiUsed ?? false,
    };

    return {
      status:
        diag.refreshStatus === 'success' ? 'success' :
        diag.refreshStatus === 'partial' ? 'partial' : 'failed',
      prices: data.prices as CanonicalPrices,
      pcMatch: data.pcMatch ?? null,
      diagnostics: diag,
      cached: false,
      source: data.prices?.loose?.source ?? 'none',
    };
  } catch (error) {
    console.error('[Market] Local pricing exception:', error);
    return null;
  }
}

function pricingResultToCanonical(result: PricingResult, warnings: string[]): CanonicalPricingResult {
  const data = result.data!;
  const prices: CanonicalPrices = {
    loose:  { value: data.loosePrice || 0,  source: data.loosePrice  > 0 ? 'pricecharting_api' : 'none', sampleCount: 0 },
    cib:    { value: data.cibPrice || 0,    source: data.cibPrice    > 0 ? 'pricecharting_api' : 'none', sampleCount: 0 },
    new:    { value: data.newPrice || 0,    source: data.newPrice    > 0 ? 'pricecharting_api' : 'none', sampleCount: 0 },
    graded: { value: data.gradedPrice || 0, source: (data.gradedPrice || 0) > 0 ? 'pricecharting_api' : 'none', sampleCount: 0 },
  };
  const missingConditions = (Object.keys(prices) as Array<keyof CanonicalPrices>)
    .filter((key) => prices[key].value === 0);

  return {
    status: missingConditions.length === 0 ? 'success' : 'partial',
    prices,
    pcMatch: {
      productId: data.pcProductId || '',
      productName: data.matchedTitle || data.productName,
      platform: data.matchedPlatform || data.console,
      strategy: data.strategy || 'lookup_pricing_fallback',
    },
    diagnostics: {
      refreshStatus: missingConditions.length === 0 ? 'success' : 'partial',
      missingConditions,
      warnings,
      ebayBlocked: false,
      pcApiUsed: true,
    },
    cached: false,
    source: 'pricecharting_api',
  };
}

function failedDiagnostics(warnings: string[]): PricingDiagnostics {
  return {
    refreshStatus: 'failed',
    missingConditions: ['loose', 'cib', 'new', 'graded'],
    warnings,
    ebayBlocked: false,
    pcApiUsed: false,
  };
}

/** Human-readable label for a condition source */
export function sourceLabel(source: ConditionSource, sampleCount?: number): string {
  switch (source) {
    case 'pricecharting_api': return 'PriceCharting';
    case 'pricecharting_web': return 'PriceCharting Web';
    case 'ebay_90d':          return sampleCount ? `eBay 90d (${sampleCount} sales)` : 'eBay 90d';
    case 'ebay_web':          return sampleCount ? `eBay (${sampleCount} sales)` : 'eBay';
    case 'cached':            return 'Cached';
    default:                  return '';
  }
}
