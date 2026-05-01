import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const PLATFORM_NORMALIZATION: Record<string, string> = {
  'playstation 5': 'Playstation 5',
  'ps5': 'Playstation 5',
  'playstation 4': 'Playstation 4',
  'ps4': 'Playstation 4',
  'playstation 3': 'Playstation 3',
  'ps3': 'Playstation 3',
  'playstation 2': 'Playstation 2',
  'ps2': 'Playstation 2',
  'playstation': 'Playstation',
  'ps1': 'Playstation',
  'psx': 'Playstation',
  'playstation vita': 'Playstation Vita',
  'ps vita': 'Playstation Vita',
  'psvita': 'Playstation Vita',
  'vita': 'Playstation Vita',
  'psp': 'PSP',
  'xbox series x': 'Xbox Series X',
  'xbox series s': 'Xbox Series X',
  'xbox series': 'Xbox Series X',
  'xbox one': 'Xbox One',
  'xbone': 'Xbox One',
  'xbox 360': 'Xbox 360',
  'x360': 'Xbox 360',
  'xbox': 'Xbox',
  'nintendo switch 2': 'Nintendo Switch 2',
  'switch 2': 'Nintendo Switch 2',
  'ns2': 'Nintendo Switch 2',
  'nintendo switch': 'Nintendo Switch',
  'switch': 'Nintendo Switch',
  'ns': 'Nintendo Switch',
  'wii u': 'Wii U',
  'wiiu': 'Wii U',
  'wii': 'Wii',
  'gamecube': 'Gamecube',
  'gc': 'Gamecube',
  'nintendo 64': 'Nintendo 64',
  'n64': 'Nintendo 64',
  'super nintendo': 'Super Nintendo',
  'snes': 'Super Nintendo',
  'nintendo entertainment system': 'NES',
  'nes': 'NES',
  'nintendo 3ds': 'Nintendo 3DS',
  '3ds': 'Nintendo 3DS',
  'nintendo ds': 'Nintendo DS',
  'ds': 'Nintendo DS',
  'game boy advance': 'GameBoy Advance',
  'gameboy advance': 'GameBoy Advance',
  'gba': 'GameBoy Advance',
  'game boy color': 'GameBoy Color',
  'gameboy color': 'GameBoy Color',
  'gbc': 'GameBoy Color',
  'game boy': 'GameBoy',
  'gameboy': 'GameBoy',
  'gb': 'GameBoy',
  'sega genesis': 'Sega Genesis',
  'genesis': 'Sega Genesis',
  'mega drive': 'Sega Genesis',
  'sega saturn': 'Sega Saturn',
  'saturn': 'Sega Saturn',
  'sega dreamcast': 'Sega Dreamcast',
  'dreamcast': 'Sega Dreamcast',
  'sega cd': 'Sega CD',
  'game gear': 'Sega Game Gear',
};

function normalizePlatform(platform: string): string {
  const lower = platform.toLowerCase().trim();
  return PLATFORM_NORMALIZATION[lower] || platform;
}

function cleanTitle(title: string): string {
  let cleaned = title;

  const publisherPrefixes = [
    /^Nintendo\s+/i,
    /^Sony\s+/i,
    /^Microsoft\s+/i,
    /^Ubisoft\s+/i,
    /^EA\s+Sports\s+/i,
    /^EA\s+/i,
    /^Activision\s+/i,
    /^Capcom\s+/i,
    /^Konami\s+/i,
    /^Square\s+Enix\s+/i,
    /^Bethesda\s+/i,
    /^Rockstar\s+Games\s+/i,
    /^Take-Two\s+Interactive\s+/i,
    /^Io\s+Interactive\s+/i,
  ];

  publisherPrefixes.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });

  cleaned = cleaned.replace(/\s*-?\s*\(?(PlayStation\s*[1-5]?|PS[1-5]|Xbox\s*(Series\s*[XS]?|One|360)?|Nintendo\s*Switch|Switch|Wii\s*U?|GameCube|N64|SNES|NES)\)?$/i, '');
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*/g, ' ');
  cleaned = cleaned.replace(/\s*\[[^\]]*\]\s*/g, ' ');
  cleaned = cleaned.replace(/\s*-?\s*(Standard|Deluxe|Ultimate|Limited|Collector's|GOTY|Game\s+of\s+the\s+Year|Complete)\s+Edition$/i, '');
  cleaned = cleaned.replace(/\b(NEW|SEALED)\b/gi, '');
  cleaned = cleaned.trim().replace(/\s+/g, ' ');

  return cleaned;
}

function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (s1 === s2) return 100;
  if (s1.includes(s2) || s2.includes(s1)) return 85;

  const words1 = str1.toLowerCase().split(/\s+/);
  const words2 = str2.toLowerCase().split(/\s+/);
  const commonWords = words1.filter(w => words2.includes(w) && w.length > 3);
  const avgLength = (words1.length + words2.length) / 2;

  return Math.min((commonWords.length / avgLength) * 100, 80);
}

function calculateConfidence(
  requestedTitle: string,
  matchedTitle: string,
  requestedPlatform: string,
  matchedPlatform: string,
  strategy: string
): number {
  let confidence = 0;

  const titleSim = calculateSimilarity(requestedTitle, matchedTitle);
  confidence += (titleSim / 100) * 50;

  const normalizedReqPlatform = normalizePlatform(requestedPlatform);
  const normalizedMatchPlatform = normalizePlatform(matchedPlatform);

  if (normalizedReqPlatform.toLowerCase() === normalizedMatchPlatform.toLowerCase()) {
    confidence += 30;
  } else if (normalizedMatchPlatform.toLowerCase().includes(normalizedReqPlatform.toLowerCase())) {
    confidence += 20;
  }

  if (strategy === 'exact_title_platform') {
    confidence += 20;
  } else if (strategy === 'cleaned_title_platform') {
    confidence += 15;
  } else if (strategy === 'title_only') {
    confidence += 10;
  }

  return Math.round(Math.min(confidence, 100));
}

function penniesToDollars(pennies: number | string | undefined): number {
  const val = typeof pennies === 'string' ? parseInt(pennies, 10) : (pennies || 0);
  if (isNaN(val) || val === 0) return 0;
  return Math.round(val) / 100;
}

interface SuccessResponse {
  success: true;
  pricingStatus: 'matched';
  matchedTitle: string;
  matchedPlatform: string;
  confidence: number;
  strategy: string;
  prices: {
    loose: number;
    cib: number;
    new: number;
    graded: number;
  };
  raw?: any;
}

interface NoMatchResponse {
  success: true;
  pricingStatus: 'no_match';
  matchedTitle: null;
  matchedPlatform: null;
  confidence: 0;
  strategy: 'none';
  prices: null;
  attemptedQueries?: string[];
}

interface ErrorResponse {
  success: false;
  pricingStatus: 'error';
  errorCode: 'FUNCTION_NOT_FOUND' | 'CONFIG_ERROR' | 'UPSTREAM_API_ERROR' | 'INVALID_INPUT';
  message: string;
}

type PricingResponse = SuccessResponse | NoMatchResponse | ErrorResponse;

async function searchSingleProduct(query: string, apiKey: string): Promise<any> {
  console.log(`[PriceCharting] Single product search: "${query}"`);

  const searchQuery = encodeURIComponent(query);
  const response = await fetch(
    `https://www.pricecharting.com/api/product?t=${apiKey}&q=${searchQuery}`,
    { headers: { 'Accept': 'application/json' } }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[PriceCharting] API error: ${response.status} - ${errorText}`);
    return null;
  }

  const data = await response.json();

  if (data.status === 'success' && data['product-name']) {
    console.log(`[PriceCharting] Found: "${data['product-name']}" (${data['console-name']})`);
    return data;
  }

  console.log(`[PriceCharting] No match for query`);
  return null;
}

async function searchMultipleProducts(query: string, apiKey: string): Promise<any[]> {
  console.log(`[PriceCharting] Multi-product search: "${query}"`);

  const searchQuery = encodeURIComponent(query);
  const response = await fetch(
    `https://www.pricecharting.com/api/products?t=${apiKey}&q=${searchQuery}`,
    { headers: { 'Accept': 'application/json' } }
  );

  if (!response.ok) {
    console.error(`[PriceCharting] Products API error: ${response.status}`);
    return [];
  }

  const data = await response.json();

  if (data.status === 'success' && data.products && data.products.length > 0) {
    console.log(`[PriceCharting] Found ${data.products.length} results`);
    return data.products;
  }

  return [];
}

async function getProductById(id: string, apiKey: string): Promise<any> {
  const response = await fetch(
    `https://www.pricecharting.com/api/product?t=${apiKey}&id=${id}`,
    { headers: { 'Accept': 'application/json' } }
  );

  if (!response.ok) return null;

  const data = await response.json();
  if (data.status === 'success' && data['product-name']) {
    return data;
  }
  return null;
}

async function getProductByUPC(upc: string, apiKey: string): Promise<any> {
  console.log(`[PriceCharting] UPC lookup: ${upc}`);
  const response = await fetch(
    `https://www.pricecharting.com/api/product?t=${apiKey}&upc=${encodeURIComponent(upc)}`,
    { headers: { 'Accept': 'application/json' } }
  );

  if (!response.ok) {
    console.error(`[PriceCharting] UPC lookup error: ${response.status}`);
    return null;
  }

  const data = await response.json();
  if (data.status === 'success' && data['product-name']) {
    console.log(`[PriceCharting] UPC matched: "${data['product-name']}" (${data['console-name']})`);
    return data;
  }

  console.log(`[PriceCharting] No UPC match for ${upc}`);
  return null;
}

const CACHE_TTL_HOURS = 24;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      const errorResponse: ErrorResponse = {
        success: false,
        pricingStatus: 'error',
        errorCode: 'INVALID_INPUT',
        message: 'Missing authorization header',
      };
      return new Response(JSON.stringify(errorResponse), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.error('[Pricing] Auth error:', authError?.message);
      const errorResponse: ErrorResponse = {
        success: false,
        pricingStatus: 'error',
        errorCode: 'INVALID_INPUT',
        message: `Authentication failed: ${authError?.message || 'Invalid token'}`,
      };
      return new Response(JSON.stringify(errorResponse), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { productName, platform, forceRefresh, upc } = await req.json();

    if (!productName || productName.trim().length === 0) {
      const errorResponse: ErrorResponse = {
        success: false,
        pricingStatus: 'error',
        errorCode: 'INVALID_INPUT',
        message: 'Product name is required',
      };
      return new Response(JSON.stringify(errorResponse), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Pricing] Looking up: "${productName}" (${platform || 'Unknown'})`);

    const normalizedPlatform = platform ? normalizePlatform(platform) : '';
    const cacheKey = `${productName.trim().toLowerCase()}|${normalizedPlatform.toLowerCase()}`;

    const { data: cached } = await supabase
      .from('pricing_cache')
      .select('*')
      .eq('product_name', productName.trim().toLowerCase())
      .eq('platform', normalizedPlatform.toLowerCase())
      .maybeSingle();

    if (!forceRefresh && cached && (Number(cached.price_loose) > 0 || Number(cached.price_cib) > 0 || Number(cached.price_new) > 0)) {
      const cacheAge = (Date.now() - new Date(cached.cached_at).getTime()) / (1000 * 60 * 60);
      if (cacheAge < CACHE_TTL_HOURS) {
        console.log(`[Pricing] Cache hit for "${productName}" (${normalizedPlatform}), age: ${cacheAge.toFixed(1)}h`);
        const successResponse: SuccessResponse = {
          success: true,
          pricingStatus: 'matched',
          matchedTitle: cached.matched_title,
          matchedPlatform: cached.matched_platform,
          confidence: cached.confidence || 80,
          strategy: cached.strategy || 'cached',
          prices: {
            loose: Number(cached.price_loose) || 0,
            cib: Number(cached.price_cib) || 0,
            new: Number(cached.price_new) || 0,
            graded: Number(cached.price_graded) || 0,
          },
        };
        return new Response(JSON.stringify(successResponse), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log(`[Pricing] Cache expired for "${productName}" (${cacheAge.toFixed(1)}h old)`);
    }

    const { data: apiKeyData, error: keyError } = await supabase
      .from('user_api_keys')
      .select('api_key, status')
      .eq('user_id', user.id)
      .eq('provider', 'pricecharting')
      .maybeSingle();

    if (keyError || !apiKeyData || apiKeyData.status !== 'active') {
      console.warn('[Pricing] No PriceCharting API key configured');
      const errorResponse: ErrorResponse = {
        success: false,
        pricingStatus: 'error',
        errorCode: 'CONFIG_ERROR',
        message: 'PriceCharting API key not configured. Please add your API key in Settings.',
      };
      return new Response(JSON.stringify(errorResponse), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanedTitle = cleanTitle(productName);

    console.log(`[Pricing] Normalized platform: "${platform}" -> "${normalizedPlatform}"`);
    console.log(`[Pricing] Cleaned title: "${productName}" -> "${cleanedTitle}"`);

    const attemptedQueries: string[] = [];
    let bestMatch: any = null;
    let matchStrategy = 'none';

    if (upc && upc.trim().length > 0) {
      attemptedQueries.push(`upc:${upc}`);
      try {
        const result = await getProductByUPC(upc.trim(), apiKeyData.api_key);
        if (result) {
          matchStrategy = 'upc';
          console.log(`[Pricing] UPC strategy matched: "${result['product-name']}"`);
          if (result.id) {
            await new Promise(resolve => setTimeout(resolve, 1100));
            const fullProduct = await getProductById(result.id, apiKeyData.api_key);
            bestMatch = fullProduct || result;
          } else {
            bestMatch = result;
          }
        }
      } catch (err) {
        console.error(`[Pricing] UPC strategy error:`, (err as any).message);
      }
    }

    if (!bestMatch && normalizedPlatform) {
      const query1 = `${productName} ${normalizedPlatform}`;
      attemptedQueries.push(query1);

      try {
        const result = await searchSingleProduct(query1, apiKeyData.api_key);
        if (result) {
          console.log(`[Pricing] Strategy 1 matched: "${result['product-name']}"`);
          if (result.id) {
            await new Promise(resolve => setTimeout(resolve, 1100));
            const fullProduct = await getProductById(result.id, apiKeyData.api_key);
            bestMatch = fullProduct || result;
          } else {
            bestMatch = result;
          }
          matchStrategy = 'exact_title_platform';
        }
      } catch (err) {
        console.error(`[Pricing] Strategy 1 error:`, err.message);
      }
    }

    if (!bestMatch && cleanedTitle !== productName && normalizedPlatform) {
      const query2 = `${cleanedTitle} ${normalizedPlatform}`;
      attemptedQueries.push(query2);

      try {
        await new Promise(resolve => setTimeout(resolve, 1100));
        const result = await searchSingleProduct(query2, apiKeyData.api_key);
        if (result) {
          console.log(`[Pricing] Strategy 2 matched: "${result['product-name']}"`);
          if (result.id) {
            await new Promise(resolve => setTimeout(resolve, 1100));
            const fullProduct = await getProductById(result.id, apiKeyData.api_key);
            bestMatch = fullProduct || result;
          } else {
            bestMatch = result;
          }
          matchStrategy = 'cleaned_title_platform';
        }
      } catch (err) {
        console.error(`[Pricing] Strategy 2 error:`, err.message);
      }
    }

    if (!bestMatch && cleanedTitle) {
      const query3 = cleanedTitle;
      attemptedQueries.push(query3);

      try {
        await new Promise(resolve => setTimeout(resolve, 1100));
        const candidates = await searchMultipleProducts(query3, apiKeyData.api_key);

        if (candidates.length > 0) {
          let chosenCandidate = candidates[0];

          if (normalizedPlatform) {
            const platformMatch = candidates.find((p: any) => {
              const cn = (p['console-name'] || '').toLowerCase();
              const np = normalizedPlatform.toLowerCase();
              return cn === np || cn.includes(np) || np.includes(cn);
            });
            if (platformMatch) {
              chosenCandidate = platformMatch;
            }
          }

          await new Promise(resolve => setTimeout(resolve, 1100));
          const fullProduct = await getProductById(chosenCandidate.id, apiKeyData.api_key);
          if (fullProduct) {
            bestMatch = fullProduct;
            matchStrategy = 'title_only';
            console.log(`[Pricing] Strategy 3 matched: "${fullProduct['product-name']}"`);
          }
        }
      } catch (err) {
        console.error(`[Pricing] Strategy 3 error:`, err.message);
      }
    }

    if (!bestMatch) {
      console.log(`[Pricing] No match found after ${attemptedQueries.length} attempts`);
      const noMatchResponse: NoMatchResponse = {
        success: true,
        pricingStatus: 'no_match',
        matchedTitle: null,
        matchedPlatform: null,
        confidence: 0,
        strategy: 'none',
        prices: null,
        attemptedQueries,
      };
      return new Response(JSON.stringify(noMatchResponse), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const matchedTitle = bestMatch['product-name'] || '';
    const matchedPlatform = bestMatch['console-name'] || '';
    const confidence = calculateConfidence(
      productName,
      matchedTitle,
      normalizedPlatform || platform || '',
      matchedPlatform,
      matchStrategy
    );

    const looseDollars = penniesToDollars(bestMatch['loose-price']);
    const cibDollars = penniesToDollars(bestMatch['cib-price']);
    const newDollars = penniesToDollars(bestMatch['new-price']);
    const gradedDollars = penniesToDollars(bestMatch['graded-price']);

    console.log(`[Pricing] Matched: "${matchedTitle}" (${matchedPlatform})`);
    console.log(`[Pricing] Confidence: ${confidence}%`);
    console.log(`[Pricing] Prices: Loose=$${looseDollars}, CIB=$${cibDollars}, New=$${newDollars}, Graded=$${gradedDollars}`);

    const prices = {
      loose: looseDollars,
      cib: cibDollars,
      new: newDollars,
      graded: gradedDollars,
    };

    try {
      await supabase
        .from('pricing_cache')
        .upsert({
          product_name: productName.trim().toLowerCase(),
          platform: normalizedPlatform.toLowerCase(),
          matched_title: matchedTitle,
          matched_platform: matchedPlatform,
          price_loose: looseDollars,
          price_cib: cibDollars,
          price_new: newDollars,
          price_graded: gradedDollars,
          confidence,
          strategy: matchStrategy,
          genre: bestMatch.genre || '',
          release_date: bestMatch['release-date'] || '',
          cached_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'product_name,platform' });
      console.log(`[Pricing] Cached pricing for "${productName}" (${normalizedPlatform})`);
    } catch (cacheErr) {
      console.error('[Pricing] Cache write failed:', cacheErr.message);
    }

    const successResponse: SuccessResponse = {
      success: true,
      pricingStatus: 'matched',
      matchedTitle,
      matchedPlatform,
      confidence,
      strategy: matchStrategy,
      prices,
      raw: {
        productId: bestMatch.id ? String(bestMatch.id) : undefined,
        genre: bestMatch.genre,
        releaseDate: bestMatch['release-date'],
      },
    };

    return new Response(JSON.stringify(successResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Pricing] Unexpected error:', error);
    const safeMessage = error instanceof Error && error.message
      ? error.message.replace(/key[=:]\s*\S+/gi, 'key=[REDACTED]')
      : 'An unexpected error occurred';
    const errorResponse: ErrorResponse = {
      success: false,
      pricingStatus: 'error',
      errorCode: 'UPSTREAM_API_ERROR',
      message: safeMessage,
    };
    return new Response(JSON.stringify(errorResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
