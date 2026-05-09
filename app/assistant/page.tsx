'use client';

import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { formatMoney, type AssistantAnalysis, type AssistantAppContext, type AnalyzedInventoryItem } from '@/lib/ai-inventory-analysis';
import { toast } from 'sonner';
import { Bot, Brain, Check, ClipboardList, DollarSign, Loader2, Package, Plus, Send, Sparkles, TriangleAlert, WifiOff } from 'lucide-react';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className="mt-1 text-lg font-bold text-white/90">{value}</div>
        </div>
        <div className="h-8 w-8 rounded-lg border border-primary/20 bg-primary/10 flex items-center justify-center">
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </div>
    </div>
  );
}

function ItemRow({ item, rank }: { item: AnalyzedInventoryItem; rank: number }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/30 bg-secondary/20 p-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary">
        {rank}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate text-sm font-semibold text-white/85">{item.product_name}</div>
          <Badge variant="outline" className="border-white/10 text-[10px] text-white/55">
            {item.console || 'Unknown'}
          </Badge>
          <Badge variant="outline" className="border-white/10 text-[10px] text-white/55">
            {item.condition || 'Condition?'}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>Market {formatMoney(item.marketValue)}</span>
          <span>Cost {formatMoney(item.cost)}</span>
          <span className={item.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}>Profit {formatMoney(item.profit)}</span>
          <span>Start {formatMoney(item.startPrice)}</span>
        </div>
        <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {item.reasons.slice(0, 3).join(' / ')}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-bold text-primary">{Math.round(item.showScore)}</div>
        <div className="text-[10px] text-muted-foreground">score</div>
      </div>
    </div>
  );
}

export default function AssistantPage() {
  const { user, accountId } = useAuth();
  const [message, setMessage] = useState('');
  const [theme, setTheme] = useState('High profit show');
  const [targetItemCount, setTargetItemCount] = useState('30');
  const [minMarginPercent, setMinMarginPercent] = useState('20');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Ask me naturally about inventory, lots, profit, prep work, show planning, or current market prices. I will use your app data first and external lookup data when the question calls for it.',
    },
  ]);
  const [analysis, setAnalysis] = useState<AssistantAnalysis | null>(null);
  const [appContext, setAppContext] = useState<AssistantAppContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingShow, setCreatingShow] = useState(false);
  const [usedAI, setUsedAI] = useState(false);
  const [openAIConfigured, setOpenAIConfigured] = useState(false);
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/ai-assistant')
      .then((response) => response.json())
      .then((data) => {
        setOpenAIConfigured(Boolean(data.openAIConfigured));
        setAiModel(data.model || null);
        if (!data.openAIConfigured) {
          setAiError('OPENAI_API_KEY is not configured in Netlify.');
        }
      })
      .catch(() => {});
  }, []);

  const askAssistant = async (prompt?: string) => {
    const content = (prompt || message).trim();
    if (!content) return;

    setLoading(true);
    setMessages((prev) => [...prev, { role: 'user', content }]);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) throw new Error('Please sign in again before using the assistant');

      const response = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          message: content,
          theme: theme || content,
          targetItemCount: parseInt(targetItemCount, 10) || 30,
          minMarginPercent: parseFloat(minMarginPercent) || 0,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Assistant request failed');

      setAnalysis(result.analysis);
      setAppContext(result.appContext);
      setUsedAI(Boolean(result.usedAI));
      setOpenAIConfigured(Boolean(result.openAIConfigured));
      setAiModel(result.aiModel || null);
      setAiError(result.aiError || null);
      const statusPrefix = result.usedAI
        ? ''
        : result.aiError
          ? `OpenAI is not connected, so I used the calculated fallback.\n\n`
          : '';
      setMessages((prev) => [...prev, { role: 'assistant', content: `${statusPrefix}${result.answer}` }]);
    } catch (error: any) {
      const message = error.message || 'Assistant request failed';
      toast.error(message);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `I could not read the inventory data for that request. Backend detail: ${message}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const createShowFromPlan = async () => {
    if (!analysis?.showPlan.items.length || !user || !accountId) return;
    setCreatingShow(true);

    try {
      const { data: show, error: showError } = await supabase
        .from('show_lists')
        .insert({
          user_id: accountId,
          name: `${analysis.showPlan.theme} - AI Curated`,
          show_date: null,
          status: 'draft',
        })
        .select('id')
        .single();

      if (showError) throw showError;

      const rows = analysis.showPlan.items.map((item) => ({
        show_list_id: show.id,
        item_id: item.id,
        start_price: item.startPrice,
        category: item.marketValue >= 45 ? 'High Value' : item.startPrice >= 10 ? '$10 Start' : '$5 Start',
      }));

      const { error: itemError } = await supabase.from('show_items').insert(rows);
      if (itemError) throw itemError;

      toast.success(`Created show with ${rows.length} item(s)`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create show');
    } finally {
      setCreatingShow(false);
    }
  };

  const summary = analysis?.summary;
  const showPlan = analysis?.showPlan;

  return (
    <DashboardLayout>
      <div className="max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="label-caps mb-1">Business</div>
            <h1 className="text-2xl font-bold tracking-tight text-white/90">AI Assistant</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Ask inventory, prep, finance, show, cleanup, and quick external pricing questions. The assistant can suggest changes, but records should only be changed after your approval.
            </p>
          </div>
          <Badge variant="outline" className={usedAI ? 'w-fit border-primary/30 text-primary' : 'w-fit border-amber-500/30 text-amber-300'}>
            {usedAI ? `OpenAI ${aiModel || ''}` : openAIConfigured ? 'OpenAI fallback' : 'OpenAI not connected'}
          </Badge>
        </div>

        {!openAIConfigured && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">OpenAI is not connected yet.</div>
              <div className="mt-1 text-amber-100/80">
                Add `OPENAI_API_KEY` in Netlify environment variables. Until then, answers use calculated fallback logic instead of the LLM.
              </div>
            </div>
          </div>
        )}

        {openAIConfigured && aiError && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            OpenAI was not used for the last answer: {aiError}
          </div>
        )}

        {summary && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Available Inventory" value={String(summary.availableItems)} icon={Package} />
            <Stat label="Market Value" value={formatMoney(summary.totalMarketValue)} icon={DollarSign} />
            <Stat label="Potential Profit" value={formatMoney(summary.totalPotentialProfit)} icon={Sparkles} />
            <Stat label="Data Issues" value={String(summary.missingPriceCount + summary.missingCostCount + summary.missingImageCount)} icon={TriangleAlert} />
          </div>
        )}

        {appContext && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Needs Cleaned" value={String(appContext.prep.needsCleaned.length)} icon={ClipboardList} />
            <Stat label="Ready to List" value={String(appContext.prep.readyToList.length)} icon={Check} />
            <Stat label="4-Day Gross Profit" value={formatMoney(appContext.finance.inventoryProfitLast4Days)} icon={DollarSign} />
            <Stat label="Unreconciled 30D" value={String(appContext.finance.ledgerLast30Days.unreconciledCount)} icon={TriangleAlert} />
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-2xl border border-border/40 bg-card">
            <div className="border-b border-border/30 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold text-white/85">Chat Analyst</h2>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {usedAI ? 'LLM active' : 'Fallback mode'}
                </span>
              </div>
            </div>

            <div className="h-[520px] space-y-3 overflow-y-auto p-4 sm:p-5">
              {messages.map((chat, index) => (
                <div key={index} className={chat.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={
                      chat.role === 'user'
                        ? 'max-w-[85%] rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground'
                        : 'max-w-[90%] whitespace-pre-wrap rounded-xl border border-border/35 bg-secondary/30 px-4 py-3 text-sm leading-relaxed text-white/80'
                    }
                  >
                    {chat.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-xl border border-border/35 bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reading inventory and checking tools
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border/30 p-4 sm:p-5">
              <div className="flex gap-2">
                <Textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="min-h-[54px] flex-1 resize-none bg-secondary/40"
                  placeholder="Ask anything about inventory, lots, profit, prep, show planning, GameStop pricing, or eBay sold comps..."
                />
                <Button className="h-auto px-4" onClick={() => askAssistant()} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-border/40 bg-card p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-white/85">Assistant Status</h2>
              </div>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary/30 px-3 py-2">
                  <span>OpenAI</span>
                  <span className={openAIConfigured ? 'text-emerald-400' : 'text-amber-300'}>
                    {openAIConfigured ? 'Connected' : 'Missing key'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary/30 px-3 py-2">
                  <span>Model</span>
                  <span className="text-white/70">{aiModel || 'Not set'}</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary/30 px-3 py-2">
                  <span>Last answer</span>
                  <span className={usedAI ? 'text-primary' : 'text-amber-300'}>{usedAI ? 'LLM' : 'Fallback'}</span>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border/40 bg-card p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-white/85">Show Curator</h2>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="theme">Theme</Label>
                  <Input id="theme" value={theme} onChange={(event) => setTheme(event.target.value)} className="bg-secondary/40" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="target">Items</Label>
                    <Input id="target" type="number" min="1" max="100" value={targetItemCount} onChange={(event) => setTargetItemCount(event.target.value)} className="bg-secondary/40" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="margin">Min Margin %</Label>
                    <Input id="margin" type="number" min="0" max="100" value={minMarginPercent} onChange={(event) => setMinMarginPercent(event.target.value)} className="bg-secondary/40" />
                  </div>
                </div>
                <Button className="w-full" onClick={() => askAssistant(`Build a show for this theme: ${theme}`)} disabled={loading}>
                  <ClipboardList className="mr-2 h-4 w-4" />
                  Generate Show Plan
                </Button>
              </div>
            </section>

            {showPlan && (
              <section className="rounded-2xl border border-border/40 bg-card p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-white/85">Current Plan</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{showPlan.items.length} item(s) selected</p>
                  </div>
                  <Button size="sm" onClick={createShowFromPlan} disabled={creatingShow || showPlan.items.length === 0}>
                    {creatingShow ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                    Create
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-secondary/30 p-3">
                    <div className="text-muted-foreground">Market</div>
                    <div className="font-bold text-white/85">{formatMoney(showPlan.totalMarketValue)}</div>
                  </div>
                  <div className="rounded-lg bg-secondary/30 p-3">
                    <div className="text-muted-foreground">Profit</div>
                    <div className="font-bold text-emerald-400">{formatMoney(showPlan.estimatedProfit)}</div>
                  </div>
                  <div className="rounded-lg bg-secondary/30 p-3">
                    <div className="text-muted-foreground">Margin</div>
                    <div className="font-bold text-white/85">{showPlan.averageMarginPercent.toFixed(1)}%</div>
                  </div>
                  <div className="rounded-lg bg-secondary/30 p-3">
                    <div className="text-muted-foreground">Theme Fit</div>
                    <div className="font-bold text-white/85">{showPlan.themeFitPercent.toFixed(0)}%</div>
                  </div>
                </div>
              </section>
            )}
          </aside>
        </div>

        {showPlan && (
          <section className="rounded-2xl border border-border/40 bg-card p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-white/85">Recommended Show Items</h2>
            </div>
            {showPlan.items.length === 0 ? (
              <div className="rounded-xl border border-border/30 bg-secondary/20 p-8 text-center text-sm text-muted-foreground">
                No items matched the current margin and pricing rules. Lower the minimum margin or refresh inventory pricing.
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {showPlan.items.slice(0, 20).map((item, index) => (
                  <ItemRow key={item.id} item={item} rank={index + 1} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}
