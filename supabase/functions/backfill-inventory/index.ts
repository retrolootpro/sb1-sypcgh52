import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const PLATFORM_PATTERNS = [
  /\(Nintendo Switch 2?\)/i, /\(Switch\)/i,
  /\(Playstation 5\)/i, /\(PS5\)/i, /\(Playstation 4\)/i, /\(PS4\)/i,
  /\(Playstation 3\)/i, /\(PS3\)/i, /\(Playstation 2\)/i, /\(PS2\)/i,
  /\(Xbox Series X(?:\/S)?\)/i, /\(Xbox One\)/i, /\(Xbox 360\)/i,
  /\(Wii U\)/i, /\(Wii\)/i, /\(GameCube\)/i,
  /\(Nintendo 3DS\)/i, /\(3DS\)/i, /\(Nintendo DS\)/i, /\(DS\)/i,
  /\(Game Boy Advance\)/i, /\(GBA\)/i,
  /\(Game Boy Color\)/i, /\(GBC\)/i,
  /\(Game Boy\)/i, /\(N64\)/i, /\(NES\)/i, /\(SNES\)/i,
  /\(Sega Genesis\)/i, /\(Sega Dreamcast\)/i,
];

const KNOWN_BRANDS = [
  'io interactive', 'ea sports', 'electronic arts', 'square enix',
  'capcom', 'konami', 'bandai namco', 'ubisoft', 'activision',
  'take-two', '2k games', 'thq', 'sega', 'atlus', 'koei tecmo',
  'nis america', 'xseed games', 'aksys games', 'limited run games',
];

const BRAND_TO_CONSOLE: Record<string, string> = {
  'nintendo switch': 'Switch',
  'nintendo switch 2': 'Switch',
  'playstation 4': 'PlayStation 4',
  'playstation 5': 'PlayStation 5',
  'playstation 3': 'PlayStation 3',
  'playstation 2': 'PlayStation 2',
  'nintendo 3ds': '3DS',
  'nintendo ds': 'DS',
  'xbox one': 'Xbox One',
  'xbox 360': 'Xbox 360',
  'xbox series x': 'Xbox Series X/S',
  'game boy advance': 'Game Boy Advance',
  'game boy color': 'Game Boy Color',
  'game boy': 'Game Boy',
};

function cleanTitle(title: string, brand: string): string {
  if (!title) return title;

  if (/^Game Title for /i.test(title)) {
    return '';
  }

  let cleaned = title;

  for (const pattern of PLATFORM_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  if (brand) {
    const brandLower = brand.toLowerCase();
    for (const known of KNOWN_BRANDS) {
      if (brandLower.includes(known) || known.includes(brandLower)) {
        const brandRegex = new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i');
        cleaned = cleaned.replace(brandRegex, '');
        break;
      }
    }
  }

  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function inferConsoleFromBrand(brand: string): string | null {
  if (!brand) return null;
  const key = brand.toLowerCase().trim();
  return BRAND_TO_CONSOLE[key] || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { itemIds, dryRun = false } = body;

    console.log(`[Backfill] Starting for user ${user.id}, dryRun=${dryRun}`);

    let query = supabase
      .from('inventory_items')
      .select('*')
      .eq('user_id', user.id);

    if (itemIds && itemIds.length > 0) {
      query = query.in('id', itemIds);
    }

    const { data: items, error: fetchError } = await query;

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch items', details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!items || items.length === 0) {
      return new Response(
        JSON.stringify({ success: true, itemsProcessed: 0, itemsUpdated: 0, itemsSkipped: 0, errors: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = {
      success: true,
      itemsProcessed: 0,
      itemsUpdated: 0,
      itemsSkipped: 0,
      errors: [] as string[],
    };

    console.log(`[Backfill] Processing ${items.length} items...`);

    const barcodesNeedingCache = items
      .filter(item => !item.description && item.barcode)
      .map(item => item.barcode);

    const cacheMap = new Map<string, any>();
    if (barcodesNeedingCache.length > 0) {
      const { data: cachedItems } = await supabase
        .from('barcode_lookup_cache')
        .select('barcode, lookup_data')
        .in('barcode', barcodesNeedingCache);

      if (cachedItems) {
        for (const cached of cachedItems) {
          cacheMap.set(cached.barcode, cached.lookup_data);
        }
      }
      console.log(`[Backfill] Pre-fetched ${cacheMap.size} barcode cache entries`);
    }

    for (const item of items) {
      result.itemsProcessed++;
      const updates: Record<string, any> = {};

      try {
        if (item.console === 'Unknown' && item.brand) {
          const inferredConsole = inferConsoleFromBrand(item.brand);
          if (inferredConsole) {
            updates.console = inferredConsole;
            updates.platform_normalized = normalizePlatform(inferredConsole);
          }
        }

        const currentTitle = item.product_name || '';
        const isPlaceholder = /^Game Title for /i.test(currentTitle) || currentTitle === 'Unknown Product';
        const cleanedTitle = cleanTitle(currentTitle, item.brand || '');

        if (isPlaceholder && item.pricing_matched_title) {
          updates.product_name = item.pricing_matched_title;
        } else if (cleanedTitle && cleanedTitle !== currentTitle) {
          updates.product_name = cleanedTitle;
        }

        if (!item.description && item.barcode && cacheMap.has(item.barcode)) {
          const lookupData = cacheMap.get(item.barcode);
          if (lookupData?.description && lookupData.description.trim()) {
            updates.description = lookupData.description.trim().substring(0, 500);
          }
        }

        const needsPricing = !item.price_loose && !item.price_cib && !item.price_new ||
          item.pricing_status !== 'matched';

        const titleForPricing = updates.product_name || item.product_name;
        const platformForPricing = updates.platform_normalized || item.platform_normalized || updates.console || item.console || 'Unknown';

        if (needsPricing && titleForPricing && !/^Game Title for /i.test(titleForPricing) && !dryRun) {
          console.log(`[Backfill] Fetching pricing for: "${titleForPricing}" (${platformForPricing})`);

          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 25000);

            const pricingResponse = await fetch(`${supabaseUrl}/functions/v1/lookup-pricing`, {
              method: 'POST',
              headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                productName: titleForPricing,
                platform: platformForPricing,
              }),
              signal: controller.signal,
            });

            clearTimeout(timeoutId);
            const pricingData = await pricingResponse.json();

            if (pricingData.success && pricingData.pricingStatus === 'matched' && pricingData.prices) {
              updates.price_loose = pricingData.prices.loose || 0;
              updates.price_cib = pricingData.prices.cib || 0;
              updates.price_new = pricingData.prices.new || 0;
              updates.price_graded = pricingData.prices.graded || 0;
              updates.pricing_status = 'matched';
              updates.pricing_confidence = pricingData.confidence || 100;
              updates.pricing_matched_title = pricingData.matchedTitle || null;
              updates.pricing_matched_platform = pricingData.matchedPlatform || null;
              updates.pricing_source = 'PriceCharting';
              updates.pricing_attempted_at = new Date().toISOString();
              updates.pricing_last_checked_at = new Date().toISOString();

              if (pricingData.raw?.genre && !item.genre) {
                updates.genre = pricingData.raw.genre;
              }

              if (isPlaceholder && pricingData.matchedTitle) {
                updates.product_name = pricingData.matchedTitle;
              }

              const condition = item.condition || 'CIB';
              let marketValue = 0;
              const pl = updates.price_loose || 0;
              const pc = updates.price_cib || 0;
              const pn = updates.price_new || 0;
              const pg = updates.price_graded || 0;
              if (condition === 'Loose') marketValue = pl || pc || pn;
              else if (condition === 'CIB') marketValue = pc || pl || pn;
              else if (condition === 'New') marketValue = pn || pc || pl;
              else if (condition === 'Graded') marketValue = pg || pn || pc || pl;
              else marketValue = pl || pc || pn;

              if (marketValue > 0) {
                const purchasePrice = parseFloat(item.purchase_price) || 0;
                const profit = marketValue - purchasePrice;
                const marginPercent = purchasePrice > 0 ? (profit / purchasePrice) * 100 : 0;

                updates.selected_market_value = marketValue;
                updates.estimated_profit = profit;
                updates.estimated_margin_percent = marginPercent;

                const dealScore = calculateDealScore(purchasePrice, marketValue, pricingData.confidence || 100);
                updates.deal_score = dealScore.score;
                updates.deal_score_label = dealScore.label;
              }

              console.log(`[Backfill] Pricing matched: Loose=$${updates.price_loose}, CIB=$${updates.price_cib}, New=$${updates.price_new}`);
            } else if (pricingData.pricingStatus === 'no_match') {
              updates.pricing_status = 'no_match';
              updates.pricing_attempted_at = new Date().toISOString();
              console.log(`[Backfill] No pricing match for "${titleForPricing}"`);
            } else if (pricingData.pricingStatus === 'error') {
              updates.pricing_status = 'error';
              updates.pricing_attempted_at = new Date().toISOString();
              console.log(`[Backfill] Pricing error for "${titleForPricing}": ${pricingData.message}`);
            }
          } catch (pricingErr: any) {
            if (pricingErr.name === 'AbortError') {
              console.error(`[Backfill] Pricing timeout for "${titleForPricing}"`);
              result.errors.push(`${titleForPricing}: pricing lookup timed out`);
            } else {
              console.error(`[Backfill] Pricing error for "${titleForPricing}":`, pricingErr.message);
              result.errors.push(`${titleForPricing}: ${pricingErr.message}`);
            }
            updates.pricing_status = 'error';
            updates.pricing_attempted_at = new Date().toISOString();
          }
        }

        const needsUpcLookup = (!item.image_url && !item.thumbnail_url) || !item.description;
        if (needsUpcLookup && item.barcode && !dryRun) {
          console.log(`[Backfill] UPC lookup for barcode: ${item.barcode}`);
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const upcResponse = await fetch(`${supabaseUrl}/functions/v1/lookup-upc`, {
              method: 'POST',
              headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ barcode: item.barcode }),
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (upcResponse.ok) {
              const upcData = await upcResponse.json();
              if (upcData.imageUrl && !item.image_url) {
                updates.image_url = upcData.imageUrl;
                updates.thumbnail_url = upcData.thumbnailUrl || upcData.imageUrl;
              }
              if (upcData.description && !item.description && !updates.description) {
                updates.description = upcData.description.trim().substring(0, 500);
              }
              if (upcData.brand && !item.brand) {
                updates.brand = upcData.brand;
              }
              if (upcData.category && !item.category) {
                updates.category = upcData.category;
              }
            }
          } catch (upcErr: any) {
            console.error(`[Backfill] UPC lookup error for "${item.product_name}":`, upcErr.message);
          }
        }

        if (!item.raw_scanned_title && item.product_name) {
          updates.raw_scanned_title = item.product_name;
        }
        if (!item.platform_raw && item.console) {
          updates.platform_raw = item.console;
        }
        if (!item.platform_normalized && !updates.platform_normalized && item.console) {
          updates.platform_normalized = normalizePlatform(updates.console || item.console);
        }

        const finalTitle = updates.product_name || item.product_name;
        if (finalTitle) {
          updates.normalized_title = finalTitle.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        }

        const pricingStatus = updates.pricing_status || item.pricing_status || 'pending';
        const marketValue = updates.selected_market_value || parseFloat(item.selected_market_value) || 0;
        const confidence = updates.pricing_confidence || item.pricing_confidence || 0;
        const finalProductName = updates.product_name || item.product_name;
        const finalConsole = updates.console || item.console;
        const needsReview = !item.barcode || !finalProductName || !finalConsole || finalConsole === 'Unknown' ||
          !item.condition || !(parseFloat(item.purchase_price) > 0) ||
          pricingStatus !== 'matched' || marketValue <= 0 || confidence < 80;

        updates.needs_review = needsReview;

        if (Object.keys(updates).length === 0) {
          result.itemsSkipped++;
          continue;
        }

        if (!dryRun) {
          const { error: updateError } = await supabase
            .from('inventory_items')
            .update(updates)
            .eq('id', item.id);

          if (updateError) {
            console.error(`[Backfill] Update error for ${item.id}:`, updateError.message);
            result.errors.push(`${item.product_name}: ${updateError.message}`);
          } else {
            result.itemsUpdated++;
            console.log(`[Backfill] Updated "${item.product_name}" (${Object.keys(updates).length} fields)`);
          }
        } else {
          result.itemsUpdated++;
        }
      } catch (itemErr: any) {
        console.error(`[Backfill] Error processing "${item.product_name}":`, itemErr.message);
        result.errors.push(`${item.product_name}: ${itemErr.message}`);
      }
    }

    console.log(`[Backfill] Done: ${result.itemsProcessed} processed, ${result.itemsUpdated} updated, ${result.itemsSkipped} skipped, ${result.errors.length} errors`);

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[Backfill] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function normalizePlatform(platform: string): string {
  const map: Record<string, string> = {
    'PlayStation 5': 'Playstation 5', 'PS5': 'Playstation 5',
    'PlayStation 4': 'Playstation 4', 'PS4': 'Playstation 4',
    'PlayStation 3': 'Playstation 3', 'PS3': 'Playstation 3',
    'PlayStation 2': 'Playstation 2', 'PS2': 'Playstation 2',
    'PlayStation': 'Playstation', 'PSX': 'Playstation',
    'Xbox Series X': 'Xbox Series X', 'Xbox Series S': 'Xbox Series X',
    'Xbox Series X/S': 'Xbox Series X',
    'Xbox One': 'Xbox One', 'Xbox 360': 'Xbox 360', 'Xbox': 'Xbox',
    'Nintendo Switch': 'Nintendo Switch', 'Switch': 'Nintendo Switch',
    'Wii U': 'Wii U', 'Wii': 'Wii',
    'GameCube': 'Gamecube', 'Nintendo 64': 'Nintendo 64', 'N64': 'Nintendo 64',
    'Super Nintendo': 'Super Nintendo', 'SNES': 'Super Nintendo',
    'NES': 'NES',
    'Game Boy Advance': 'GameBoy Advance', 'GBA': 'GameBoy Advance',
    'Game Boy Color': 'GameBoy Color', 'GBC': 'GameBoy Color',
    'Game Boy': 'GameBoy', 'GB': 'GameBoy',
    'Nintendo 3DS': 'Nintendo 3DS', '3DS': 'Nintendo 3DS',
    'Nintendo DS': 'Nintendo DS', 'DS': 'Nintendo DS',
  };
  return map[platform] || platform;
}

function calculateDealScore(purchasePrice: number, marketValue: number, confidence: number): { score: number; label: string } {
  if (marketValue === 0 || purchasePrice === 0) return { score: 0, label: 'No Data' };

  const profitMargin = ((marketValue - purchasePrice) / purchasePrice) * 100;
  const profitAmount = marketValue - purchasePrice;

  let baseScore = 0;
  if (profitMargin >= 300) baseScore = 95;
  else if (profitMargin >= 200) baseScore = 90;
  else if (profitMargin >= 150) baseScore = 85;
  else if (profitMargin >= 100) baseScore = 75;
  else if (profitMargin >= 75) baseScore = 65;
  else if (profitMargin >= 50) baseScore = 55;
  else if (profitMargin >= 30) baseScore = 45;
  else if (profitMargin >= 15) baseScore = 35;
  else if (profitMargin >= 5) baseScore = 25;
  else if (profitMargin >= 0) baseScore = 15;
  else baseScore = 5;

  const absoluteProfitBonus = Math.min(profitAmount / 10, 10);
  const confidencePenalty = ((100 - confidence) / 100) * 15;
  let finalScore = baseScore + absoluteProfitBonus - confidencePenalty;

  if (profitMargin >= 100 && profitAmount >= 20) finalScore += 5;
  finalScore = Math.max(0, Math.min(100, finalScore));

  if (finalScore >= 85) return { score: Math.round(finalScore), label: 'Steal' };
  if (finalScore >= 70) return { score: Math.round(finalScore), label: 'Great' };
  if (finalScore >= 55) return { score: Math.round(finalScore), label: 'Good' };
  if (finalScore >= 40) return { score: Math.round(finalScore), label: 'Fair' };
  if (finalScore >= 25) return { score: Math.round(finalScore), label: 'Risky' };
  return { score: Math.round(finalScore), label: 'Avoid' };
}
