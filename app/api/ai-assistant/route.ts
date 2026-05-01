import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  analyzeInventory,
  buildAppContext,
  buildAppDeterministicAnswer,
  type AssistantAnalysis,
  type AssistantAppContext,
  type AssistantInventoryItem,
} from '@/lib/ai-inventory-analysis';

export const dynamic = 'force-dynamic';

type AssistantRequest = {
  message?: string;
  theme?: string;
  targetItemCount?: number;
  minMarginPercent?: number;
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function compactAnalysisForAi(analysis: AssistantAnalysis, app: AssistantAppContext) {
  return {
    summary: analysis.summary,
    prep: {
      needsSortedCount: app.prep.needsSorted.length,
      needsCleanedCount: app.prep.needsCleaned.length,
      needsTestedCount: app.prep.needsTested.length,
      needsNotesCount: app.prep.needsNotes.length,
      readyToListCount: app.prep.readyToList.length,
      listedCount: app.prep.listed.length,
      needsCleaned: app.prep.needsCleaned.slice(0, 15).map((item) => ({
        name: item.product_name,
        console: item.console,
        condition: item.condition,
      })),
      readyToList: app.prep.readyToList.slice(0, 15).map((item) => ({
        name: item.product_name,
        console: item.console,
        condition: item.condition,
      })),
    },
    finance: {
      inventoryProfitLast4Days: app.finance.inventoryProfitLast4Days,
      inventoryProfitLast7Days: app.finance.inventoryProfitLast7Days,
      inventoryProfitLast30Days: app.finance.inventoryProfitLast30Days,
      revenueLast4Days: app.finance.revenueLast4Days,
      soldLast4DaysCount: app.finance.soldLast4Days.length,
      ledgerLast30Days: app.finance.ledgerLast30Days,
      recentTransactions: app.finance.recentTransactions.slice(0, 12),
    },
    shows: app.shows,
    suggestedActions: app.suggestedActions,
    showPlan: {
      ...analysis.showPlan,
      items: analysis.showPlan.items.slice(0, 20).map((item) => ({
        id: item.id,
        name: item.product_name,
        console: item.console,
        condition: item.condition,
        cost: item.cost,
        marketValue: item.marketValue,
        profit: item.profit,
        marginPercent: item.marginPercent,
        ageDays: item.ageDays,
        score: item.showScore,
        startPrice: item.startPrice,
        reasons: item.reasons,
      })),
    },
    topProfitItems: analysis.topProfitItems.slice(0, 12).map((item) => ({
      name: item.product_name,
      console: item.console,
      condition: item.condition,
      cost: item.cost,
      marketValue: item.marketValue,
      profit: item.profit,
      marginPercent: item.marginPercent,
    })),
    staleItems: analysis.staleItems.slice(0, 8).map((item) => ({
      name: item.product_name,
      console: item.console,
      ageDays: item.ageDays,
      profit: item.profit,
    })),
    dataIssues: analysis.dataIssues.slice(0, 8).map((item) => ({
      name: item.product_name,
      console: item.console,
      missingPrice: item.marketValue <= 0,
      missingCost: item.cost <= 0,
      missingImage: !item.image_url,
    })),
  };
}

function outputTextFromResponse(data: any) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const chunks: string[] = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

async function askOpenAI(message: string, analysis: AssistantAnalysis, app: AssistantAppContext) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      store: false,
      max_output_tokens: 900,
      instructions:
        'You are RetroLoot Pro Analyst, a practical resale business assistant. Use only the provided app data: inventory, prep, finance, shows, and suggestions. Do not invent prices, sales, quantities, or app capabilities. If data is missing, say exactly what is missing. You may recommend changes, but clearly say changes require user approval before records are modified. Keep recommendations concise and actionable.',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `User request: ${message}\n\nApp analysis JSON:\n${JSON.stringify(compactAnalysisForAi(analysis, app))}`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) return null;
  const data = await response.json();
  return outputTextFromResponse(data) || null;
}

export async function GET() {
  return json({
    ok: true,
    message: 'AI assistant endpoint is running. Use POST from the Assistant page.',
    openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader) return json({ success: false, message: 'Missing authorization' }, 401);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) return json({ success: false, message: 'Auth failed' }, 401);

    const body = (await req.json()) as AssistantRequest;
    const message = body.message?.trim() || 'Give me the best business opportunities in my inventory.';

    const [inventoryRes, txRes, showsRes] = await Promise.all([
      supabase
        .from('inventory_items')
        .select(
          'id, product_name, console, condition, purchase_price, selected_market_value, price_loose, price_cib, price_new, price_graded, estimated_profit, estimated_margin_percent, deal_score, deal_score_label, status, quantity, created_at, sold_at, sell_price, sold_via, image_url, category, genre, notes, sorted_at, cleaned_at, tested_at, notes_added_at, on_rack_at, listed_ebay_at, listed_amazon_at, listed_whatnot_at, lot_id'
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1500),
      supabase
        .from('financial_transactions')
        .select('id, date, description, amount, type, category, source, platform, is_reconciled')
        .eq('user_id', user.id)
        .order('date', { ascending: false })
        .limit(500),
      supabase
        .from('show_lists')
        .select('id, name, show_date, created_at, status, show_items(id)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (inventoryRes.error) throw inventoryRes.error;
    if (txRes.error) throw txRes.error;
    if (showsRes.error) throw showsRes.error;

    const inventory = (inventoryRes.data || []) as AssistantInventoryItem[];
    const analysis = analyzeInventory(inventory, {
      theme: body.theme || message,
      targetItemCount: body.targetItemCount,
      minMarginPercent: body.minMarginPercent,
    });
    const appContext = buildAppContext(inventory, (txRes.data || []) as any, (showsRes.data || []) as any);

    let answer = buildAppDeterministicAnswer(message, analysis, appContext);
    let usedAI = false;

    try {
      const aiAnswer = await askOpenAI(message, analysis, appContext);
      if (aiAnswer) {
        answer = aiAnswer;
        usedAI = true;
      }
    } catch {
      usedAI = false;
    }

    return json({
      success: true,
      answer,
      usedAI,
      openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
      analysis,
      appContext,
    });
  } catch (error) {
    return json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Assistant request failed',
      },
      500
    );
  }
}
