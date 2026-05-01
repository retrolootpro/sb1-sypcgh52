import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface UPCLookupResult {
  barcode: string;
  title: string;
  description?: string;
  brand?: string;
  category?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  provider?: string;
  cached?: boolean;
}

async function lookupWithPriceCharting(barcode: string, apiKey: string): Promise<UPCLookupResult | null> {
  console.log(`[PriceCharting UPC] Looking up barcode: ${barcode}`);

  const url = `https://www.pricecharting.com/api/product?t=${apiKey}&upc=${barcode}`;
  const response = await fetch(url, { headers: { 'Accept': 'application/json' } });

  if (response.status === 404 || response.status === 400) {
    console.log(`[PriceCharting UPC] No product found (${response.status})`);
    return null;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[PriceCharting UPC] API error: ${response.status} - ${errorText}`);
    throw new Error(`PriceCharting API returned ${response.status}`);
  }

  const data = await response.json();

  if (data.status !== 'success' || !data['product-name']) {
    console.log('[PriceCharting UPC] No product found for this UPC');
    return null;
  }

  console.log(`[PriceCharting UPC] Found: "${data['product-name']}" (${data['console-name']})`);

  return {
    barcode,
    title: data['product-name'] || '',
    description: data.genre || '',
    brand: data['console-name'] || '',
    category: data.genre || '',
    imageUrl: '',
    thumbnailUrl: '',
    provider: 'pricecharting',
  };
}

async function lookupWithBarcodeLookup(barcode: string, apiKey: string): Promise<UPCLookupResult | null> {
  const response = await fetch(
    `https://api.barcodelookup.com/v3/products?barcode=${barcode}&formatted=y&key=${apiKey}`
  );

  if (response.status === 404 || response.status === 400) {
    console.log(`[BarcodeLookup] No product found (${response.status})`);
    return null;
  }

  if (!response.ok) {
    throw new Error(`Barcode Lookup failed: ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.products || data.products.length === 0) {
    return null;
  }

  const product = data.products[0];

  return {
    barcode,
    title: product.title || product.product_name || '',
    description: product.description || '',
    brand: product.brand || product.manufacturer || '',
    category: product.category || '',
    imageUrl: product.images?.[0] || '',
    thumbnailUrl: product.images?.[0] || '',
    provider: 'barcode_lookup',
  };
}

async function lookupWithUPCItemDB(barcode: string, apiKey: string): Promise<UPCLookupResult | null> {
  const response = await fetch(
    `https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`,
    {
      headers: {
        'Accept': 'application/json',
        'user_key': apiKey,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`UPCitemDB failed: ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.items || data.items.length === 0) {
    return null;
  }

  const item = data.items[0];

  return {
    barcode,
    title: item.title || '',
    description: item.description || '',
    brand: item.brand || '',
    category: item.category || '',
    imageUrl: item.images?.[0] || '',
    thumbnailUrl: item.images?.[0] || '',
    provider: 'upcitemdb',
  };
}

async function lookupImageWithGoogle(title: string, combinedKey: string): Promise<string | null> {
  const parts = combinedKey.split(':');
  if (parts.length < 2) {
    console.error('[Google] Invalid key format — expected API_KEY:CX_ID');
    return null;
  }
  const apiKey = parts[0].trim();
  const cx = parts.slice(1).join(':').trim();
  console.log(`[Google] Searching for image: "${title}"`);

  const params = new URLSearchParams({
    key: apiKey,
    cx,
    q: title,
    searchType: 'image',
    num: '3',
    imgType: 'photo',
    safe: 'active',
  });

  try {
    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[Google] API error ${response.status}: ${err.slice(0, 200)}`);
      return null;
    }

    const data = await response.json();
    const items = data.items as Array<{ link: string; image?: { thumbnailLink?: string } }> | undefined;
    if (!items || items.length === 0) {
      console.log('[Google] No image results');
      return null;
    }

    const imageUrl = items[0].link;
    console.log(`[Google] Found image for "${title}": ${imageUrl}`);
    return imageUrl;
  } catch (err: any) {
    console.error('[Google] Fetch failed:', err.message);
    return null;
  }
}

async function lookupImageWithSteam(title: string): Promise<string | null> {
  console.log(`[Steam] Searching for image: "${title}"`);

  const response = await fetch(
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`,
    { headers: { 'Accept': 'application/json' } }
  );

  if (!response.ok) {
    console.error(`[Steam] API error: ${response.status}`);
    return null;
  }

  const data = await response.json();

  if (!data.items || data.items.length === 0) {
    console.log('[Steam] No results found');
    return null;
  }

  const appId = data.items[0].id;
  const imageUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
  console.log(`[Steam] Found image for "${title}" (appId: ${appId}): ${imageUrl}`);
  return imageUrl;
}

async function lookupImageWithRAWG(title: string, apiKey?: string): Promise<string | null> {
  if (!apiKey) return null;
  console.log(`[RAWG] Searching for image: "${title}"`);

  const params = new URLSearchParams({ search: title, page_size: '3', key: apiKey });

  const response = await fetch(`https://api.rawg.io/api/games?${params.toString()}`, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    console.error(`[RAWG] API error: ${response.status}`);
    return null;
  }

  const data = await response.json();

  if (!data.results || data.results.length === 0) {
    console.log('[RAWG] No results found');
    return null;
  }

  const imageUrl = data.results[0].background_image;
  if (imageUrl) {
    console.log(`[RAWG] Found image for "${title}": ${imageUrl}`);
  }
  return imageUrl || null;
}

function mergeResults(primary: UPCLookupResult, secondary: UPCLookupResult): UPCLookupResult {
  return {
    barcode: primary.barcode,
    title: primary.title || secondary.title,
    description: primary.description || secondary.description || '',
    brand: primary.brand || secondary.brand || '',
    category: primary.category || secondary.category || '',
    imageUrl: primary.imageUrl || secondary.imageUrl || '',
    thumbnailUrl: primary.thumbnailUrl || secondary.thumbnailUrl || '',
    provider: `${primary.provider}+${secondary.provider}`,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: `Authentication failed: ${authError?.message || 'Invalid token'}` }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { barcode, titleHint } = body;
    if (!barcode) {
      return new Response(
        JSON.stringify({ error: 'Barcode is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: cached } = await supabase
      .from('barcode_lookup_cache')
      .select('lookup_data, provider, cached_at, expires_at')
      .eq('barcode', barcode)
      .maybeSingle();

    if (cached && cached.lookup_data && new Date(cached.expires_at) > new Date()) {
      const cachedResult = cached.lookup_data as UPCLookupResult;
      if (cachedResult.imageUrl) {
        console.log(`[UPC] Cache hit for ${barcode} (provider: ${cached.provider})`);
        return new Response(
          JSON.stringify({ ...cachedResult, barcode, cached: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log(`[UPC] Cache hit but no image for ${barcode} — will try to enrich`);
    }

    const { data: apiKeys, error: keyError } = await supabase
      .from('user_api_keys')
      .select('api_key, status, provider')
      .eq('user_id', user.id)
      .in('provider', ['pricecharting', 'upc_lookup', 'barcode_lookup', 'rawg', 'google_search'])
      .eq('status', 'active');

    if (keyError || !apiKeys || apiKeys.length === 0) {
      return new Response(
        JSON.stringify({ error: 'UPC lookup API key not configured. Please add a PriceCharting, Barcode Lookup, or UPCitemDB API key in Settings.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rawgKey = apiKeys.find(k => k.provider === 'rawg')?.api_key;
    const googleKey = apiKeys.find(k => k.provider === 'google_search')?.api_key;
    const barcodeProviders = apiKeys.filter(k => k.provider !== 'rawg' && k.provider !== 'google_search');

    const providerOrder = ['barcode_lookup', 'pricecharting', 'upc_lookup'];
    const sortedKeys = barcodeProviders.sort((a, b) =>
      providerOrder.indexOf(a.provider) - providerOrder.indexOf(b.provider)
    );

    let primaryResult: UPCLookupResult | null = null;
    const errors: Record<string, string> = {};

    for (const keyData of sortedKeys) {
      try {
        console.log(`[UPC] Trying provider: ${keyData.provider}`);

        let providerResult: UPCLookupResult | null = null;
        if (keyData.provider === 'pricecharting') {
          providerResult = await lookupWithPriceCharting(barcode, keyData.api_key);
        } else if (keyData.provider === 'barcode_lookup') {
          providerResult = await lookupWithBarcodeLookup(barcode, keyData.api_key);
        } else if (keyData.provider === 'upc_lookup') {
          providerResult = await lookupWithUPCItemDB(barcode, keyData.api_key);
        }

        if (providerResult) {
          console.log(`[UPC] Found product via ${keyData.provider} (imageUrl: ${!!providerResult.imageUrl})`);
          if (!primaryResult) {
            primaryResult = providerResult;
            if (primaryResult.imageUrl) {
              break;
            }
            console.log(`[UPC] No image from ${keyData.provider}, trying remaining providers for image enrichment`);
          } else {
            if (providerResult.imageUrl) {
              primaryResult = mergeResults(primaryResult, providerResult);
              console.log(`[UPC] Enriched with image from ${keyData.provider}`);
              break;
            }
          }
        } else {
          errors[keyData.provider] = 'Product not found';
        }
      } catch (error) {
        console.error(`[UPC] Error with ${keyData.provider}:`, error.message);
        errors[keyData.provider] = error.message;
      }
    }

    if (!primaryResult && titleHint) {
      console.log(`[UPC] Barcode not found in any DB but titleHint provided — searching for image by title`);
      primaryResult = {
        barcode,
        title: titleHint,
        imageUrl: '',
        thumbnailUrl: '',
        provider: 'title_hint',
      };
    }

    if (!primaryResult) {
      return new Response(
        JSON.stringify({
          error: 'Product not found in any database',
          details: Object.entries(errors).map(([p, e]) => `${p}: ${e}`).join('; '),
          providers_tried: Object.keys(errors),
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!primaryResult.imageUrl && primaryResult.title) {
      console.log(`[UPC] No image found via barcode providers — trying web image search`);

      if (googleKey) {
        try {
          const googleImage = await lookupImageWithGoogle(primaryResult.title, googleKey);
          if (googleImage) {
            primaryResult.imageUrl = googleImage;
            primaryResult.thumbnailUrl = googleImage;
            primaryResult.provider = primaryResult.provider ? `${primaryResult.provider}+google` : 'google';
            console.log(`[UPC] Got image from Google for "${primaryResult.title}"`);
          }
        } catch (err: any) {
          console.error('[UPC] Google image search failed:', err.message);
        }
      }

      if (!primaryResult.imageUrl && rawgKey) {
        try {
          const rawgImage = await lookupImageWithRAWG(primaryResult.title, rawgKey);
          if (rawgImage) {
            primaryResult.imageUrl = rawgImage;
            primaryResult.thumbnailUrl = rawgImage;
            primaryResult.provider = primaryResult.provider ? `${primaryResult.provider}+rawg` : 'rawg';
            console.log(`[UPC] Got image from RAWG for "${primaryResult.title}"`);
          }
        } catch (err) {
          console.error('[UPC] RAWG search failed:', err.message);
        }
      }

      if (!primaryResult.imageUrl) {
        try {
          const steamImage = await lookupImageWithSteam(primaryResult.title);
          if (steamImage) {
            primaryResult.imageUrl = steamImage;
            primaryResult.thumbnailUrl = steamImage;
            primaryResult.provider = primaryResult.provider ? `${primaryResult.provider}+steam` : 'steam';
            console.log(`[UPC] Got image from Steam for "${primaryResult.title}"`);
          } else {
            console.log(`[UPC] Steam also found no image for "${primaryResult.title}"`);
          }
        } catch (steamErr) {
          console.error('[UPC] Steam image search failed:', steamErr.message);
        }
      }
    }

    try {
      const cacheData = {
        title: primaryResult.title,
        description: primaryResult.description,
        brand: primaryResult.brand,
        category: primaryResult.category,
        imageUrl: primaryResult.imageUrl,
        thumbnailUrl: primaryResult.thumbnailUrl,
      };

      await supabase
        .from('barcode_lookup_cache')
        .upsert({
          barcode,
          lookup_data: cacheData,
          provider: primaryResult.provider || 'unknown',
          cached_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'barcode' });

      console.log(`[UPC] Cached result for ${barcode} (imageUrl: ${!!primaryResult.imageUrl})`);
    } catch (cacheErr) {
      console.error('[UPC] Cache write failed:', cacheErr.message);
    }

    return new Response(
      JSON.stringify(primaryResult),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[UPC] Error:', error);
    const safeMessage = error instanceof Error && error.message
      ? error.message.replace(/key[=:]\s*\S+/gi, 'key=[REDACTED]')
      : 'An unexpected error occurred';
    return new Response(
      JSON.stringify({ error: safeMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
