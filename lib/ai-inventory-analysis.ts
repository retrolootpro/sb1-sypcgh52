export type AssistantInventoryItem = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  purchase_price: number | null;
  selected_market_value: number | null;
  price_loose: number | null;
  price_cib: number | null;
  price_new: number | null;
  price_graded: number | null;
  estimated_profit: number | null;
  estimated_margin_percent: number | null;
  deal_score: number | null;
  deal_score_label: string | null;
  status: string | null;
  quantity: number | null;
  created_at: string | null;
  sold_at?: string | null;
  sell_price?: number | null;
  sold_via?: string | null;
  image_url: string | null;
  category: string | null;
  genre: string | null;
  notes: string | null;
  sorted_at?: string | null;
  cleaned_at?: string | null;
  tested_at?: string | null;
  notes_added_at?: string | null;
  on_rack_at?: string | null;
  listed_ebay_at?: string | null;
  listed_amazon_at?: string | null;
  listed_whatnot_at?: string | null;
  lot_id?: string | null;
};

export type AnalyzedInventoryItem = AssistantInventoryItem & {
  marketValue: number;
  cost: number;
  profit: number;
  marginPercent: number;
  ageDays: number;
  themeScore: number;
  profitScore: number;
  readinessScore: number;
  showScore: number;
  startPrice: number;
  reasons: string[];
};

export type InventorySummary = {
  totalItems: number;
  availableItems: number;
  soldItems: number;
  totalCost: number;
  totalMarketValue: number;
  totalPotentialProfit: number;
  averageMarginPercent: number;
  missingPriceCount: number;
  missingCostCount: number;
  missingImageCount: number;
  staleCount: number;
  topConsole: string;
};

export type ShowPlan = {
  theme: string;
  targetItemCount: number;
  items: AnalyzedInventoryItem[];
  totalCost: number;
  totalMarketValue: number;
  estimatedProfit: number;
  averageMarginPercent: number;
  themeFitPercent: number;
};

export type AssistantAnalysis = {
  summary: InventorySummary;
  topProfitItems: AnalyzedInventoryItem[];
  staleItems: AnalyzedInventoryItem[];
  dataIssues: AnalyzedInventoryItem[];
  showPlan: ShowPlan;
};

export type AssistantTransaction = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: string;
  category: string;
  source: string | null;
  platform: string | null;
  is_reconciled: boolean | null;
};

export type AssistantShow = {
  id: string;
  name: string;
  show_date: string | null;
  created_at: string | null;
  show_items?: { id: string }[];
};

export type AssistantAppContext = {
  prep: {
    needsSorted: AssistantInventoryItem[];
    needsCleaned: AssistantInventoryItem[];
    needsTested: AssistantInventoryItem[];
    needsNotes: AssistantInventoryItem[];
    readyToList: AssistantInventoryItem[];
    listed: AssistantInventoryItem[];
  };
  finance: {
    recentTransactions: AssistantTransaction[];
    soldLast4Days: AssistantInventoryItem[];
    soldLast7Days: AssistantInventoryItem[];
    soldLast30Days: AssistantInventoryItem[];
    ledgerLast30Days: {
      income: number;
      expenses: number;
      net: number;
      unreconciledCount: number;
    };
    inventoryProfitLast4Days: number;
    inventoryProfitLast7Days: number;
    inventoryProfitLast30Days: number;
    revenueLast4Days: number;
  };
  shows: {
    recentShows: AssistantShow[];
    draftCount: number;
  };
  suggestedActions: string[];
};

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'game',
  'games',
  'night',
  'of',
  'show',
  'the',
  'to',
  'with',
]);

export function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);
}

function numberValue(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function words(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function getMarketValue(item: AssistantInventoryItem) {
  const selected = numberValue(item.selected_market_value);
  if (selected > 0) return selected;

  const loose = numberValue(item.price_loose);
  const cib = numberValue(item.price_cib);
  const sealed = numberValue(item.price_new);
  const graded = numberValue(item.price_graded);

  switch ((item.condition || '').toLowerCase()) {
    case 'cib':
      return cib || loose || sealed || graded;
    case 'new':
      return sealed || cib || loose || graded;
    case 'graded':
      return graded || sealed || cib || loose;
    default:
      return loose || cib || sealed || graded;
  }
}

function daysSince(value: string | null) {
  if (!value) return 0;
  const created = new Date(value);
  if (Number.isNaN(created.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000));
}

function themeScore(item: AssistantInventoryItem, theme: string) {
  const themeWords = words(theme);
  if (themeWords.length === 0) return 50;

  const haystack = [
    item.product_name,
    item.console,
    item.condition,
    item.category,
    item.genre,
    item.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  let matches = 0;
  for (const word of themeWords) {
    if (haystack.includes(word)) matches += 1;
  }

  const base = (matches / themeWords.length) * 100;
  const brandBoost =
    /nintendo|mario|zelda|pokemon|kirby|switch|wii|gamecube|ds|3ds/i.test(theme) &&
    /nintendo|mario|zelda|pokemon|kirby|switch|wii|gamecube|ds|3ds/i.test(haystack)
      ? 18
      : 0;
  const horrorBoost =
    /horror|spooky|scary|resident|evil|silent/i.test(theme) &&
    /horror|resident evil|silent hill|dead space|evil within/i.test(haystack)
      ? 22
      : 0;
  const sportsPenalty = /clearance|budget|under|cheap/i.test(theme) ? 0 : /sports/i.test(haystack) ? -8 : 0;

  return Math.max(0, Math.min(100, base + brandBoost + horrorBoost + sportsPenalty));
}

function startPriceFor(marketValue: number) {
  if (marketValue >= 45) return Math.max(10, Math.round(marketValue * 0.65));
  if (marketValue >= 20) return 10;
  return 5;
}

export function analyzeInventory(
  rawItems: AssistantInventoryItem[],
  options: { theme?: string; targetItemCount?: number; minMarginPercent?: number } = {}
): AssistantAnalysis {
  const theme = options.theme?.trim() || 'High profit show';
  const targetItemCount = Math.max(1, Math.min(100, options.targetItemCount || 30));
  const minMarginPercent = Number.isFinite(options.minMarginPercent) ? Number(options.minMarginPercent) : 20;

  const analyzed = rawItems
    .map((item) => {
      const marketValue = getMarketValue(item);
      const cost = numberValue(item.purchase_price);
      const profit = marketValue - cost;
      const marginPercent = marketValue > 0 ? (profit / marketValue) * 100 : 0;
      const ageDays = daysSince(item.created_at);
      const itemThemeScore = themeScore(item, theme);
      const profitScore = Math.max(0, Math.min(100, profit * 2 + marginPercent));
      const readinessScore = (item.image_url ? 15 : 0) + (marketValue > 0 ? 35 : 0) + (cost > 0 ? 25 : 0) + (item.product_name ? 25 : 0);
      const agingBoost = ageDays > 90 ? 8 : ageDays > 45 ? 4 : 0;
      const showScore = Math.max(
        0,
        Math.min(100, itemThemeScore * 0.38 + profitScore * 0.42 + readinessScore * 0.16 + agingBoost)
      );
      const reasons = [
        profit > 0 ? `${formatMoney(profit)} estimated profit` : 'thin or negative estimated profit',
        marketValue > 0 ? `${formatMoney(marketValue)} market value` : 'missing market value',
        itemThemeScore >= 60 ? 'strong theme fit' : itemThemeScore >= 30 ? 'partial theme fit' : 'weak theme fit',
      ];
      if (ageDays > 60) reasons.push(`${ageDays} days in inventory`);
      if (!item.image_url) reasons.push('needs a stronger image');

      return {
        ...item,
        marketValue,
        cost,
        profit,
        marginPercent,
        ageDays,
        themeScore: itemThemeScore,
        profitScore,
        readinessScore,
        showScore,
        startPrice: startPriceFor(marketValue),
        reasons,
      };
    })
    .filter((item) => (item.status || 'available') === 'available');

  const showCandidates = analyzed
    .filter((item) => item.marketValue > 0 && item.marginPercent >= minMarginPercent)
    .sort((a, b) => b.showScore - a.showScore)
    .slice(0, targetItemCount);

  const totalCost = analyzed.reduce((sum, item) => sum + item.cost, 0);
  const totalMarketValue = analyzed.reduce((sum, item) => sum + item.marketValue, 0);
  const totalPotentialProfit = analyzed.reduce((sum, item) => sum + item.profit, 0);
  const consoleCounts = analyzed.reduce<Record<string, number>>((acc, item) => {
    const key = item.console || 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const topConsole = Object.entries(consoleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None';

  const showCost = showCandidates.reduce((sum, item) => sum + item.cost, 0);
  const showMarketValue = showCandidates.reduce((sum, item) => sum + item.marketValue, 0);
  const showProfit = showCandidates.reduce((sum, item) => sum + item.profit, 0);

  return {
    summary: {
      totalItems: rawItems.length,
      availableItems: analyzed.length,
      soldItems: rawItems.filter((item) => item.status === 'sold').length,
      totalCost,
      totalMarketValue,
      totalPotentialProfit,
      averageMarginPercent: totalMarketValue > 0 ? (totalPotentialProfit / totalMarketValue) * 100 : 0,
      missingPriceCount: analyzed.filter((item) => item.marketValue <= 0).length,
      missingCostCount: analyzed.filter((item) => item.cost <= 0).length,
      missingImageCount: analyzed.filter((item) => !item.image_url).length,
      staleCount: analyzed.filter((item) => item.ageDays > 60).length,
      topConsole,
    },
    topProfitItems: analyzed
      .filter((item) => item.marketValue > 0)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 12),
    staleItems: analyzed
      .filter((item) => item.ageDays > 60)
      .sort((a, b) => b.ageDays - a.ageDays)
      .slice(0, 12),
    dataIssues: analyzed
      .filter((item) => item.marketValue <= 0 || item.cost <= 0 || !item.image_url)
      .sort((a, b) => b.marketValue - a.marketValue)
      .slice(0, 12),
    showPlan: {
      theme,
      targetItemCount,
      items: showCandidates,
      totalCost: showCost,
      totalMarketValue: showMarketValue,
      estimatedProfit: showProfit,
      averageMarginPercent: showMarketValue > 0 ? (showProfit / showMarketValue) * 100 : 0,
      themeFitPercent: showCandidates.length > 0
        ? showCandidates.reduce((sum, item) => sum + item.themeScore, 0) / showCandidates.length
        : 0,
    },
  };
}

export function buildDeterministicAnswer(message: string, analysis: AssistantAnalysis) {
  const lower = message.toLowerCase();
  const { summary, showPlan, topProfitItems, staleItems, dataIssues } = analysis;

  if (lower.includes('show') || lower.includes('curate') || lower.includes('theme')) {
    if (showPlan.items.length === 0) {
      return `I could not build a strong show list yet. The main blocker is pricing or cost data: ${summary.missingPriceCount} available item(s) are missing market value and ${summary.missingCostCount} are missing cost. Refresh pricing and allocate lot costs first.`;
    }

    const leaders = showPlan.items
      .slice(0, 5)
      .map((item, index) => `${index + 1}. ${item.product_name} (${item.console}, ${item.condition}) - ${formatMoney(item.marketValue)} market, ${formatMoney(item.profit)} profit`)
      .join('\n');

    return `I built a ${showPlan.items.length}-item show plan for "${showPlan.theme}". Estimated market value is ${formatMoney(showPlan.totalMarketValue)} with about ${formatMoney(showPlan.estimatedProfit)} potential profit and an average ${showPlan.averageMarginPercent.toFixed(1)}% margin.\n\nTop picks:\n${leaders}`;
  }

  if (lower.includes('bad data') || lower.includes('missing') || lower.includes('clean')) {
    if (dataIssues.length === 0) return 'Your available inventory looks clean on the main fields I checked: pricing, cost basis, and image coverage.';
    const rows = dataIssues
      .slice(0, 6)
      .map((item) => `- ${item.product_name}: ${item.marketValue <= 0 ? 'missing price; ' : ''}${item.cost <= 0 ? 'missing cost; ' : ''}${!item.image_url ? 'missing image' : ''}`)
      .join('\n');
    return `I found ${summary.missingPriceCount} item(s) missing market value, ${summary.missingCostCount} missing cost, and ${summary.missingImageCount} missing images.\n\nStart here:\n${rows}`;
  }

  if (lower.includes('stale') || lower.includes('sitting') || lower.includes('old')) {
    if (staleItems.length === 0) return 'Nothing available is over 60 days old right now, based on the created dates in inventory.';
    const rows = staleItems
      .slice(0, 6)
      .map((item) => `- ${item.product_name}: ${item.ageDays} days old, ${formatMoney(item.profit)} estimated profit`)
      .join('\n');
    return `You have ${summary.staleCount} item(s) over 60 days old. These are good candidates for show starts, bundles, or price drops.\n\n${rows}`;
  }

  const rows = topProfitItems
    .slice(0, 6)
    .map((item) => `- ${item.product_name} (${item.console}): ${formatMoney(item.profit)} estimated profit on ${formatMoney(item.marketValue)} market value`)
    .join('\n');

  return `Here is the quick business read: ${summary.availableItems} available item(s), ${formatMoney(summary.totalMarketValue)} estimated market value, and ${formatMoney(summary.totalPotentialProfit)} potential gross profit. Average margin is ${summary.averageMarginPercent.toFixed(1)}%, and your largest inventory category is ${summary.topConsole}.\n\nTop profit opportunities:\n${rows || 'No priced inventory yet.'}`;
}

function sinceDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function isAfter(value: string | null | undefined, date: Date) {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed >= date;
}

function sumSoldProfit(items: AssistantInventoryItem[]) {
  return items.reduce((sum, item) => sum + (numberValue(item.sell_price) - numberValue(item.purchase_price)), 0);
}

function sumSoldRevenue(items: AssistantInventoryItem[]) {
  return items.reduce((sum, item) => sum + numberValue(item.sell_price), 0);
}

export function buildAppContext(
  items: AssistantInventoryItem[],
  transactions: AssistantTransaction[] = [],
  shows: AssistantShow[] = []
): AssistantAppContext {
  const activeItems = items.filter((item) => (item.status || 'available') !== 'sold');
  const soldItems = items.filter((item) => item.status === 'sold');
  const last4 = sinceDate(4);
  const last7 = sinceDate(7);
  const last30 = sinceDate(30);

  const soldLast4Days = soldItems.filter((item) => isAfter(item.sold_at, last4));
  const soldLast7Days = soldItems.filter((item) => isAfter(item.sold_at, last7));
  const soldLast30Days = soldItems.filter((item) => isAfter(item.sold_at, last30));
  const txLast30 = transactions.filter((tx) => isAfter(tx.date, last30));
  const income = txLast30.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + Math.abs(numberValue(tx.amount)), 0);
  const expenses = txLast30.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + Math.abs(numberValue(tx.amount)), 0);

  const prep = {
    needsSorted: activeItems.filter((item) => !item.sorted_at),
    needsCleaned: activeItems.filter((item) => !item.cleaned_at),
    needsTested: activeItems.filter((item) => !item.tested_at),
    needsNotes: activeItems.filter((item) => !item.notes_added_at),
    readyToList: activeItems.filter(
      (item) => item.on_rack_at && !item.listed_ebay_at && !item.listed_amazon_at && !item.listed_whatnot_at
    ),
    listed: activeItems.filter((item) => Boolean(item.listed_ebay_at || item.listed_amazon_at || item.listed_whatnot_at)),
  };

  const suggestedActions: string[] = [];
  if (prep.needsCleaned.length > 0) suggestedActions.push(`Clean ${prep.needsCleaned.length} item(s) still waiting in prep.`);
  if (prep.readyToList.length > 0) suggestedActions.push(`List ${prep.readyToList.length} item(s) already on rack.`);
  if (txLast30.some((tx) => !tx.is_reconciled)) suggestedActions.push('Reconcile recent financial transactions.');
  if (soldLast4Days.length > 0) suggestedActions.push('Review recent sales and restock similar profitable categories.');

  return {
    prep,
    finance: {
      recentTransactions: transactions.slice(0, 25),
      soldLast4Days,
      soldLast7Days,
      soldLast30Days,
      ledgerLast30Days: {
        income,
        expenses,
        net: income - expenses,
        unreconciledCount: txLast30.filter((tx) => !tx.is_reconciled).length,
      },
      inventoryProfitLast4Days: sumSoldProfit(soldLast4Days),
      inventoryProfitLast7Days: sumSoldProfit(soldLast7Days),
      inventoryProfitLast30Days: sumSoldProfit(soldLast30Days),
      revenueLast4Days: sumSoldRevenue(soldLast4Days),
    },
    shows: {
      recentShows: shows.slice(0, 10),
      draftCount: shows.filter((show: any) => show.status === 'draft').length,
    },
    suggestedActions,
  };
}

export function buildAppDeterministicAnswer(message: string, analysis: AssistantAnalysis, app: AssistantAppContext) {
  const lower = message.toLowerCase();

  if (lower.includes('clean')) {
    const rows = app.prep.needsCleaned
      .slice(0, 10)
      .map((item) => `- ${item.product_name} (${item.console || 'Unknown'}, ${item.condition || 'Condition?'})`)
      .join('\n');
    return app.prep.needsCleaned.length > 0
      ? `${app.prep.needsCleaned.length} available item(s) still need cleaned.\n\n${rows}`
      : 'No available inventory is currently marked as needing cleaning.';
  }

  if (lower.includes('test')) {
    const rows = app.prep.needsTested
      .slice(0, 10)
      .map((item) => `- ${item.product_name} (${item.console || 'Unknown'}, ${item.condition || 'Condition?'})`)
      .join('\n');
    return app.prep.needsTested.length > 0
      ? `${app.prep.needsTested.length} available item(s) still need tested.\n\n${rows}`
      : 'No available inventory is currently marked as needing testing.';
  }

  if (lower.includes('ready') && lower.includes('list')) {
    const rows = app.prep.readyToList
      .slice(0, 10)
      .map((item) => `- ${item.product_name} (${item.console || 'Unknown'})`)
      .join('\n');
    return app.prep.readyToList.length > 0
      ? `${app.prep.readyToList.length} item(s) are on rack and ready to list.\n\n${rows}`
      : 'No items are currently on rack and waiting to be listed.';
  }

  if (lower.includes('profit') && (lower.includes('4 day') || lower.includes('four day') || lower.includes('last 4'))) {
    return `In the last 4 days, sold inventory shows ${formatMoney(app.finance.revenueLast4Days)} revenue and ${formatMoney(app.finance.inventoryProfitLast4Days)} gross inventory profit across ${app.finance.soldLast4Days.length} sold item(s). This uses sold item sell price minus purchase price, so platform fees and shipping expenses are not subtracted unless they are entered in the ledger.`;
  }

  if (lower.includes('profit') && (lower.includes('30 day') || lower.includes('month'))) {
    return `In the last 30 days, sold inventory shows ${formatMoney(app.finance.inventoryProfitLast30Days)} gross inventory profit. Your finance ledger for the same window shows ${formatMoney(app.finance.ledgerLast30Days.income)} income, ${formatMoney(app.finance.ledgerLast30Days.expenses)} expenses, and ${formatMoney(app.finance.ledgerLast30Days.net)} net cash movement.`;
  }

  if (lower.includes('reconcile') || lower.includes('bank') || lower.includes('ledger')) {
    return `For the last 30 days, the ledger has ${formatMoney(app.finance.ledgerLast30Days.income)} income and ${formatMoney(app.finance.ledgerLast30Days.expenses)} expenses, with ${app.finance.ledgerLast30Days.unreconciledCount} unreconciled transaction(s). Suggested next step: reconcile those against bank activity before relying on net profit for tax or buying decisions.`;
  }

  if (lower.includes('suggest') || lower.includes('change') || lower.includes('fix')) {
    const rows = app.suggestedActions.map((action) => `- ${action}`).join('\n');
    return rows
      ? `Suggested actions I would queue for approval:\n${rows}\n\nI will not change records automatically. Ask for a specific change, and I can add an approval step before applying it.`
      : 'I do not see urgent app-wide actions from the current data. The next best move is to keep pricing, cost basis, and prep statuses current.';
  }

  return buildDeterministicAnswer(message, analysis);
}
