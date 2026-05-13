export type BusinessRuleItem = {
  product_name: string;
  console?: string | null;
  condition?: string | null;
  region?: string | null;
  category?: string | null;
  genre?: string | null;
  description?: string | null;
  notes?: string | null;
  purchase_price?: number | null;
  quantity?: number | null;
  selected_market_value?: number | null;
  price_loose?: number | null;
  price_cib?: number | null;
  price_new?: number | null;
  price_graded?: number | null;
  pricing_confidence?: number | null;
  pricing_last_checked_at?: string | null;
  created_at?: string | null;
};

export type PricePlan = {
  recommendedAskingPrice: number;
  quickSalePrice: number;
  floorPrice: number;
  emergencyFloorPrice: number;
  expectedProfit: number;
  marginPercent: number;
  confidenceScore: number;
};

export type SellChannelRecommendation = {
  channel: 'eBay' | 'Whatnot Auction' | 'Whatnot BIN' | 'Local/Facebook' | 'Amazon' | 'Bundle Only' | 'Hold' | 'Do Not Buy Again';
  singleOrBundle: 'single' | 'bundle' | 'either';
  summary: string;
  reasons: string[];
  cautions: string[];
};

export type ListingDraft = {
  title: string;
  description: string;
  conditionNotes: string;
  whatnotNotes: string;
  tags: string[];
  suggestedCategory: string;
  shippingNotes: string;
};

export type ItemBusinessPlan = {
  marketValue: number;
  costBasis: number;
  pricePlan: PricePlan;
  recommendation: SellChannelRecommendation;
  listingDraft: ListingDraft;
};

function numberValue(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function roundCurrency(value: number) {
  return Math.max(0, Math.round(value * 100) / 100);
}

function retailRound(value: number) {
  if (value <= 0) return 0;
  if (value < 5) return roundCurrency(value);
  return roundCurrency(Math.max(4.99, Math.ceil(value) - 0.01));
}

function conditionMarketValue(item: BusinessRuleItem) {
  const selected = numberValue(item.selected_market_value);
  if (selected > 0) return selected;

  const loose = numberValue(item.price_loose);
  const cib = numberValue(item.price_cib);
  const newPrice = numberValue(item.price_new);
  const graded = numberValue(item.price_graded);

  switch ((item.condition || '').toLowerCase()) {
    case 'cib':
      return cib || loose || newPrice || graded;
    case 'new':
    case 'sealed':
      return newPrice || cib || loose || graded;
    case 'graded':
      return graded || newPrice || cib || loose;
    default:
      return loose || cib || newPrice || graded;
  }
}

function inventoryAgeDays(item: BusinessRuleItem) {
  if (!item.created_at) return 0;
  const created = new Date(item.created_at);
  if (Number.isNaN(created.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000));
}

function isImportRegion(item: BusinessRuleItem) {
  const region = (item.region || '').toUpperCase();
  return region === 'JP' || region === 'PAL';
}

function looksLikeConsole(item: BusinessRuleItem) {
  const text = `${item.product_name} ${item.console} ${item.category}`.toLowerCase();
  return /\b(console|system|bundle|controller|accessory)\b/.test(text);
}

function buildPricePlan(item: BusinessRuleItem, marketValue: number): PricePlan {
  const costBasis = numberValue(item.purchase_price);
  const confidenceScore = Math.max(
    0,
    Math.min(100, numberValue(item.pricing_confidence) || (marketValue > 0 ? 70 : 0))
  );

  if (marketValue <= 0) {
    return {
      recommendedAskingPrice: 0,
      quickSalePrice: 0,
      floorPrice: costBasis > 0 ? retailRound(costBasis * 1.2) : 0,
      emergencyFloorPrice: costBasis > 0 ? retailRound(costBasis * 1.05) : 0,
      expectedProfit: 0,
      marginPercent: 0,
      confidenceScore,
    };
  }

  const condition = (item.condition || '').toLowerCase();
  const askingMultiplier = condition === 'new' || condition === 'sealed' || condition === 'graded' ? 1.08 : 1.12;
  const recommendedAskingPrice = retailRound(marketValue * askingMultiplier);
  const quickSalePrice = retailRound(marketValue * 0.85);
  const floorByMargin = costBasis > 0 ? costBasis * 1.2 : 0;
  const floorPrice = retailRound(Math.min(recommendedAskingPrice, Math.max(marketValue * 0.7, floorByMargin)));
  const emergencyFloorPrice = retailRound(Math.min(floorPrice || recommendedAskingPrice, Math.max(marketValue * 0.55, costBasis * 1.05)));
  const expectedProfit = roundCurrency(recommendedAskingPrice - costBasis);
  const marginPercent = recommendedAskingPrice > 0 ? roundCurrency((expectedProfit / recommendedAskingPrice) * 100) : 0;

  return {
    recommendedAskingPrice,
    quickSalePrice,
    floorPrice,
    emergencyFloorPrice,
    expectedProfit,
    marginPercent,
    confidenceScore,
  };
}

function buildRecommendation(item: BusinessRuleItem, marketValue: number, pricePlan: PricePlan): SellChannelRecommendation {
  const costBasis = numberValue(item.purchase_price);
  const profit = marketValue - costBasis;
  const ageDays = inventoryAgeDays(item);
  const condition = (item.condition || '').toLowerCase();
  const reasons: string[] = [];
  const cautions: string[] = [];

  if (marketValue <= 0) {
    return {
      channel: 'Hold',
      singleOrBundle: 'single',
      summary: 'Hold until pricing is refreshed or manually reviewed.',
      reasons: ['No usable market value is available yet.'],
      cautions: ['Do not list this item until a price is confirmed.'],
    };
  }

  if (marketValue < 8) {
    reasons.push('Low individual value makes fees and shipping inefficient.');
    return {
      channel: 'Bundle Only',
      singleOrBundle: 'bundle',
      summary: 'Bundle with similar platform, franchise, or category items.',
      reasons,
      cautions: ['Avoid selling as a standalone item unless it supports a larger order.'],
    };
  }

  if (profit <= 0 && costBasis > 0) {
    reasons.push('Current market value does not clear the recorded cost basis.');
    return {
      channel: 'Do Not Buy Again',
      singleOrBundle: marketValue < 15 ? 'bundle' : 'either',
      summary: 'Do not rebuy at this cost; recover cash carefully.',
      reasons,
      cautions: ['Review the cost basis and pricing match before discounting.'],
    };
  }

  if (looksLikeConsole(item) && marketValue >= 75) {
    reasons.push('Higher value and larger shipping risk favor local or marketplace sale.');
    return {
      channel: 'Local/Facebook',
      singleOrBundle: 'single',
      summary: 'List locally first if pickup is practical, then cross-list if needed.',
      reasons,
      cautions: ['Confirm testing, cords, serial number, and packing photos before sale.'],
    };
  }

  if (condition === 'graded' || condition === 'new' || condition === 'sealed' || marketValue >= 45) {
    reasons.push('Value is high enough to justify eBay search demand and buyer reach.');
    if (isImportRegion(item)) cautions.push('Call out region compatibility clearly in title and condition notes.');
    return {
      channel: 'eBay',
      singleOrBundle: 'single',
      summary: 'Use eBay as the primary channel for maximum buyer reach.',
      reasons,
      cautions,
    };
  }

  if (ageDays >= 90) {
    reasons.push(`${ageDays} days in stock makes this a good show or bundle candidate.`);
    return {
      channel: 'Whatnot Auction',
      singleOrBundle: 'either',
      summary: 'Move through Whatnot or bundle to convert stale inventory into cash.',
      reasons,
      cautions: ['Use the floor price to avoid selling below target margin.'],
    };
  }

  if (marketValue >= 18 && pricePlan.marginPercent >= 25) {
    reasons.push('Good margin with a mid-range price point fits Whatnot BIN or auction flow.');
    return {
      channel: 'Whatnot BIN',
      singleOrBundle: 'single',
      summary: 'Use Whatnot BIN or auction depending on show theme.',
      reasons,
      cautions: [],
    };
  }

  reasons.push('Moderate value item with enough margin for either single listing or bundle support.');
  return {
    channel: 'Whatnot Auction',
    singleOrBundle: 'either',
    summary: 'Use as a show item, or pair with similar low/mid value inventory.',
    reasons,
    cautions: [],
  };
}

function cleanTitle(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function buildListingDraft(item: BusinessRuleItem, pricePlan: PricePlan, recommendation: SellChannelRecommendation): ListingDraft {
  const titleParts = [
    cleanTitle(item.product_name || 'Untitled Item'),
    item.console,
    item.condition,
    isImportRegion(item) ? item.region : '',
  ].filter(Boolean);
  const title = cleanTitle(titleParts.join(' ')).slice(0, 80);
  const condition = item.condition || 'Used';
  const platform = item.console || 'Video Games';
  const category = item.category || (looksLikeConsole(item) ? 'Console / Accessory' : 'Video Game');
  const importNote = isImportRegion(item)
    ? `This is a ${item.region} region item. Please confirm compatibility with your system before purchasing.`
    : '';
  const testedNote = /untested|as-is|damaged/i.test(`${item.condition} ${item.notes}`)
    ? 'Sold as-is based on the condition shown and described.'
    : 'Item should be verified against photos and testing notes before publishing.';

  return {
    title,
    description: [
      `${title} for ${platform}.`,
      `Condition: ${condition}.`,
      item.description || '',
      importNote,
      testedNote,
      'Please review all photos and notes before purchasing.',
    ].filter(Boolean).join('\n\n'),
    conditionNotes: [
      `Condition: ${condition}.`,
      item.notes || '',
      importNote,
    ].filter(Boolean).join(' '),
    whatnotNotes: `${title} - start near $${pricePlan.floorPrice.toFixed(2)}, target $${pricePlan.quickSalePrice.toFixed(2)}+. ${recommendation.summary}`,
    tags: [
      platform,
      condition,
      item.genre || '',
      item.region || '',
      recommendation.channel,
    ].filter(Boolean).slice(0, 8),
    suggestedCategory: category,
    shippingNotes: looksLikeConsole(item)
      ? 'Confirm weight, dimensions, cords, serial number, and packing photos before shipment.'
      : 'Ship in a protective mailer or box with tracking. Add padding for case/disc protection.',
  };
}

export function buildItemBusinessPlan(item: BusinessRuleItem): ItemBusinessPlan {
  const marketValue = conditionMarketValue(item);
  const costBasis = numberValue(item.purchase_price);
  const pricePlan = buildPricePlan(item, marketValue);
  const recommendation = buildRecommendation(item, marketValue, pricePlan);
  const listingDraft = buildListingDraft(item, pricePlan, recommendation);

  return {
    marketValue,
    costBasis,
    pricePlan,
    recommendation,
    listingDraft,
  };
}
