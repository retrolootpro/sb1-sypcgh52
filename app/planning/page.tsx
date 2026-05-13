'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  analyzePrebuyLot,
  createBundle,
  createBuyRule,
  createDisputeCase,
  createPrebuyAnalysis,
  disputeResponseTemplate,
  getPlanningData,
  type BuyRule,
  type DisputeCase,
  type DisputeReason,
  type InventoryBundle,
  type InventoryForBundle,
  type PrebuyLotAnalysis,
  type PrebuyLotItem,
} from '@/lib/resale-planning-service';
import { Archive, Boxes, Gavel, Loader2, Plus, ShieldAlert, ShoppingBasket, Target } from 'lucide-react';
import { toast } from 'sonner';

type Tab = 'analyzer' | 'bundles' | 'buylist' | 'disputes';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'analyzer', label: 'Lot Analyzer', icon: Target },
  { id: 'bundles', label: 'Bundles', icon: Boxes },
  { id: 'buylist', label: 'Buy Guide', icon: ShoppingBasket },
  { id: 'disputes', label: 'Disputes', icon: ShieldAlert },
];

function money(value: number | null | undefined) {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

function decisionStyle(decision: string) {
  if (decision === 'good_buy') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (decision === 'risky_buy') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (decision === 'pass') return 'border-red-500/30 bg-red-500/10 text-red-300';
  return 'border-border/50 text-muted-foreground';
}

function parseLotItems(raw: string): PrebuyLotItem[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [title, platform = '', value = '0', risk = 'normal', role = 'normal'] = line.split('|').map((part) => part.trim());
      return {
        title,
        platform,
        estimated_market_value: Number(value) || 0,
        estimated_sell_price: Number(value) || 0,
        risk_level: ['low', 'normal', 'high', 'avoid'].includes(risk) ? risk as PrebuyLotItem['risk_level'] : 'normal',
        item_role: ['best_item', 'normal', 'slow_mover', 'risky', 'avoid'].includes(role) ? role as PrebuyLotItem['item_role'] : 'normal',
        sort_order: index,
      };
    });
}

export default function PlanningPage() {
  const [tab, setTab] = useState<Tab>('analyzer');
  const [loading, setLoading] = useState(true);
  const [disputes, setDisputes] = useState<DisputeCase[]>([]);
  const [bundles, setBundles] = useState<InventoryBundle[]>([]);
  const [rules, setRules] = useState<BuyRule[]>([]);
  const [analyses, setAnalyses] = useState<PrebuyLotAnalysis[]>([]);
  const [inventory, setInventory] = useState<InventoryForBundle[]>([]);
  const [saving, setSaving] = useState(false);

  const [lotForm, setLotForm] = useState({
    name: '',
    source: '',
    supplier: '',
    asking_price: '',
    estimated_shipping: '',
    estimated_fees: '',
    notes: '',
    itemsText: 'Mario Party 8|Wii|24|normal|best_item\nLow value sports game|Xbox 360|6|high|slow_mover',
  });
  const [bundleForm, setBundleForm] = useState({
    name: '',
    strategy: 'manual',
    best_channel: 'Whatnot Auction',
    notes: '',
    itemIds: [] as string[],
  });
  const [ruleForm, setRuleForm] = useState({
    subject_type: 'item',
    subject: '',
    recommendation: 'watch' as BuyRule['recommendation'],
    max_buy_price: '',
    target_margin_percent: '35',
    reason: '',
    evidence_summary: '',
  });
  const [disputeForm, setDisputeForm] = useState({
    inventory_item_id: '__none__',
    platform: 'ebay',
    order_reference: '',
    buyer_name: '',
    tracking_number: '',
    reason: 'item_as_described' as DisputeReason,
    claim_amount: '',
    condition_notes: '',
    testing_status: '',
    packing_notes: '',
    buyer_messages: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPlanningData();
      setDisputes(data.disputes);
      setBundles(data.bundles);
      setRules(data.rules);
      setAnalyses(data.analyses);
      setInventory(data.inventory);
    } catch (error: any) {
      toast.error(error.message || 'Failed to load planning data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const lotPreview = useMemo(() => {
    return analyzePrebuyLot(
      parseLotItems(lotForm.itemsText),
      Number(lotForm.asking_price) || 0,
      Number(lotForm.estimated_shipping) || 0,
      Number(lotForm.estimated_fees) || 0
    );
  }, [lotForm]);

  const selectedBundleItems = useMemo(
    () => inventory.filter((item) => bundleForm.itemIds.includes(item.id)),
    [bundleForm.itemIds, inventory]
  );

  const handleCreateAnalysis = async () => {
    if (!lotForm.name.trim()) return toast.error('Lot name is required');
    const items = parseLotItems(lotForm.itemsText);
    if (items.length === 0) return toast.error('Add at least one lot item');
    setSaving(true);
    try {
      await createPrebuyAnalysis({
        name: lotForm.name,
        source: lotForm.source,
        supplier: lotForm.supplier,
        asking_price: Number(lotForm.asking_price) || 0,
        estimated_shipping: Number(lotForm.estimated_shipping) || 0,
        estimated_fees: Number(lotForm.estimated_fees) || 0,
        notes: lotForm.notes,
        items,
      });
      toast.success('Lot analysis saved');
      setLotForm({ ...lotForm, name: '', source: '', supplier: '', asking_price: '', estimated_shipping: '', estimated_fees: '', notes: '' });
      load();
    } catch (error: any) {
      toast.error(error.message || 'Could not save analysis');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateBundle = async () => {
    if (!bundleForm.name.trim()) return toast.error('Bundle name is required');
    if (bundleForm.itemIds.length === 0) return toast.error('Select at least one item');
    setSaving(true);
    try {
      await createBundle({ ...bundleForm, inventory });
      toast.success('Bundle created');
      setBundleForm({ name: '', strategy: 'manual', best_channel: 'Whatnot Auction', notes: '', itemIds: [] });
      load();
    } catch (error: any) {
      toast.error(error.message || 'Could not create bundle');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRule = async () => {
    if (!ruleForm.subject.trim()) return toast.error('Subject is required');
    setSaving(true);
    try {
      await createBuyRule({
        subject_type: ruleForm.subject_type,
        subject: ruleForm.subject,
        recommendation: ruleForm.recommendation,
        max_buy_price: Number(ruleForm.max_buy_price) || 0,
        target_margin_percent: Number(ruleForm.target_margin_percent) || 0,
        reason: ruleForm.reason,
        evidence_summary: ruleForm.evidence_summary,
      });
      toast.success('Buy guide rule saved');
      setRuleForm({ subject_type: 'item', subject: '', recommendation: 'watch', max_buy_price: '', target_margin_percent: '35', reason: '', evidence_summary: '' });
      load();
    } catch (error: any) {
      toast.error(error.message || 'Could not save rule');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateDispute = async () => {
    setSaving(true);
    try {
      await createDisputeCase({
        ...disputeForm,
        inventory_item_id: disputeForm.inventory_item_id === '__none__' ? null : disputeForm.inventory_item_id,
        claim_amount: Number(disputeForm.claim_amount) || 0,
      });
      toast.success('Dispute case opened');
      setDisputeForm({ inventory_item_id: '__none__', platform: 'ebay', order_reference: '', buyer_name: '', tracking_number: '', reason: 'item_as_described', claim_amount: '', condition_notes: '', testing_status: '', packing_notes: '', buyer_messages: '' });
      load();
    } catch (error: any) {
      toast.error(error.message || 'Could not open dispute');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-7xl space-y-6 p-4 sm:p-6">
        <div>
          <div className="label-caps mb-1">Operations</div>
          <h1 className="text-xl font-bold tracking-tight text-white/90">Planning</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pre-buy analysis, bundle planning, buy guide rules, and dispute evidence.
          </p>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-border/40">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-xs font-medium transition-colors ${
                  tab === item.id ? 'border-primary text-primary' : 'border-transparent text-white/40 hover:text-white/70'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : tab === 'analyzer' ? (
          <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
            <div className="rounded-2xl border border-border/40 bg-card p-4">
              <h2 className="text-sm font-semibold">Analyze Potential Lot</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Input placeholder="Lot name" value={lotForm.name} onChange={(e) => setLotForm({ ...lotForm, name: e.target.value })} />
                <Input placeholder="Source" value={lotForm.source} onChange={(e) => setLotForm({ ...lotForm, source: e.target.value })} />
                <Input placeholder="Supplier" value={lotForm.supplier} onChange={(e) => setLotForm({ ...lotForm, supplier: e.target.value })} />
                <Input type="number" placeholder="Asking price" value={lotForm.asking_price} onChange={(e) => setLotForm({ ...lotForm, asking_price: e.target.value })} />
                <Input type="number" placeholder="Shipping" value={lotForm.estimated_shipping} onChange={(e) => setLotForm({ ...lotForm, estimated_shipping: e.target.value })} />
                <Input type="number" placeholder="Fees/taxes" value={lotForm.estimated_fees} onChange={(e) => setLotForm({ ...lotForm, estimated_fees: e.target.value })} />
              </div>
              <div className="mt-3">
                <Textarea
                  rows={8}
                  value={lotForm.itemsText}
                  onChange={(e) => setLotForm({ ...lotForm, itemsText: e.target.value })}
                  placeholder="One item per line: Title|Platform|Estimated Value|Risk low/normal/high/avoid|Role best_item/normal/slow_mover/risky/avoid"
                />
              </div>
              <Textarea className="mt-3" rows={3} placeholder="Notes" value={lotForm.notes} onChange={(e) => setLotForm({ ...lotForm, notes: e.target.value })} />
              <div className="mt-4 flex justify-end">
                <Button onClick={handleCreateAnalysis} disabled={saving}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Save Analysis
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-border/40 bg-card p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Live Decision</h2>
                  <Badge variant="outline" className={decisionStyle(lotPreview.decision)}>{lotPreview.decision.replace('_', ' ')}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div><div className="text-xs text-muted-foreground">Resale</div><div className="text-lg font-bold">{money(lotPreview.estimated_resale_value)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Total Cost</div><div className="text-lg font-bold">{money(lotPreview.total_estimated_cost)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Max Buy</div><div className="text-lg font-bold text-primary">{money(lotPreview.recommended_max_buy_price)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Profit</div><div className="text-lg font-bold">{money(lotPreview.expected_profit)}</div></div>
                  <div className="col-span-2"><div className="text-xs text-muted-foreground">Worst Case</div><div className="text-lg font-bold">{money(lotPreview.worst_case_liquidation_value)}</div></div>
                </div>
                {lotPreview.risk_flags.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {lotPreview.risk_flags.map((flag) => <div key={flag} className="text-xs text-amber-300">{flag}</div>)}
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-border/40 bg-card p-4">
                <h2 className="text-sm font-semibold">Recent Analyses</h2>
                <div className="mt-3 space-y-2">
                  {analyses.slice(0, 5).map((analysis) => (
                    <div key={analysis.id} className="rounded-lg border border-border/30 bg-secondary/20 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-sm font-medium">{analysis.name}</div>
                        <Badge variant="outline" className={decisionStyle(analysis.decision)}>{analysis.decision.replace('_', ' ')}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Ask {money(analysis.asking_price)} · max {money(analysis.recommended_max_buy_price)} · profit {money(analysis.expected_profit)}
                      </div>
                    </div>
                  ))}
                  {analyses.length === 0 && <div className="text-xs text-muted-foreground">No saved analyses yet.</div>}
                </div>
              </div>
            </div>
          </div>
        ) : tab === 'bundles' ? (
          <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
            <div className="rounded-2xl border border-border/40 bg-card p-4">
              <h2 className="text-sm font-semibold">Create Bundle</h2>
              <div className="mt-4 space-y-3">
                <Input placeholder="Bundle name" value={bundleForm.name} onChange={(e) => setBundleForm({ ...bundleForm, name: e.target.value })} />
                <Select value={bundleForm.strategy} onValueChange={(value) => setBundleForm({ ...bundleForm, strategy: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['manual', 'platform', 'franchise', 'category', 'slow_movers', 'import', 'accessories', 'books_manga', 'clearance'].map((value) => <SelectItem key={value} value={value}>{value.replace('_', ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={bundleForm.best_channel} onValueChange={(value) => setBundleForm({ ...bundleForm, best_channel: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['eBay', 'Whatnot Auction', 'Whatnot BIN', 'Facebook Marketplace', 'Local', 'Amazon'].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Textarea rows={3} placeholder="Notes" value={bundleForm.notes} onChange={(e) => setBundleForm({ ...bundleForm, notes: e.target.value })} />
                <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-border/30 bg-secondary/10 p-2">
                  {inventory.filter((item) => !item.bundle_id).slice(0, 80).map((item) => {
                    const selected = bundleForm.itemIds.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setBundleForm((form) => ({ ...form, itemIds: selected ? form.itemIds.filter((id) => id !== item.id) : [...form.itemIds, item.id] }))}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${selected ? 'border-primary/35 bg-primary/10 text-primary' : 'border-border/20 text-muted-foreground hover:bg-secondary/30'}`}
                      >
                        {item.product_name} · {item.console} · {money(item.selected_market_value || item.price_cib || item.price_loose)}
                      </button>
                    );
                  })}
                </div>
                <Button className="w-full" onClick={handleCreateBundle} disabled={saving}>Create Bundle</Button>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {bundles.map((bundle) => (
                <div key={bundle.id} className="rounded-2xl border border-border/40 bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">{bundle.name}</h3>
                    <Badge variant="outline">{bundle.status}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>Cost <strong>{money(bundle.cost_basis)}</strong></div>
                    <div>Market <strong>{money(bundle.market_value)}</strong></div>
                    <div>Ask <strong className="text-primary">{money(bundle.recommended_ask)}</strong></div>
                    <div>Profit <strong>{money(bundle.expected_profit)}</strong></div>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">{bundle.bundle_items?.length || 0} items · {bundle.best_channel}</div>
                </div>
              ))}
              {bundles.length === 0 && <div className="rounded-2xl border border-border/40 bg-card p-8 text-center text-sm text-muted-foreground">No bundles yet.</div>}
            </div>
          </div>
        ) : tab === 'buylist' ? (
          <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
            <div className="rounded-2xl border border-border/40 bg-card p-4">
              <h2 className="text-sm font-semibold">Add Buy Guide Rule</h2>
              <div className="mt-4 space-y-3">
                <Select value={ruleForm.subject_type} onValueChange={(value) => setRuleForm({ ...ruleForm, subject_type: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{['item', 'platform', 'category', 'franchise', 'supplier', 'source'].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="Subject, e.g. Wii Sports or PS2" value={ruleForm.subject} onChange={(e) => setRuleForm({ ...ruleForm, subject: e.target.value })} />
                <Select value={ruleForm.recommendation} onValueChange={(value) => setRuleForm({ ...ruleForm, recommendation: value as BuyRule['recommendation'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{['buy_under', 'bundle_only', 'avoid', 'hold', 'watch'].map((value) => <SelectItem key={value} value={value}>{value.replace('_', ' ')}</SelectItem>)}</SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-3">
                  <Input type="number" placeholder="Max buy price" value={ruleForm.max_buy_price} onChange={(e) => setRuleForm({ ...ruleForm, max_buy_price: e.target.value })} />
                  <Input type="number" placeholder="Target margin %" value={ruleForm.target_margin_percent} onChange={(e) => setRuleForm({ ...ruleForm, target_margin_percent: e.target.value })} />
                </div>
                <Textarea rows={3} placeholder="Reason" value={ruleForm.reason} onChange={(e) => setRuleForm({ ...ruleForm, reason: e.target.value })} />
                <Textarea rows={3} placeholder="Evidence summary" value={ruleForm.evidence_summary} onChange={(e) => setRuleForm({ ...ruleForm, evidence_summary: e.target.value })} />
                <Button className="w-full" onClick={handleCreateRule} disabled={saving}>Save Rule</Button>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {rules.map((rule) => (
                <div key={rule.id} className="rounded-2xl border border-border/40 bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{rule.subject}</div>
                      <div className="text-xs text-muted-foreground">{rule.subject_type}</div>
                    </div>
                    <Badge variant="outline" className={rule.recommendation === 'avoid' ? 'border-red-500/30 text-red-300' : 'border-primary/30 text-primary'}>{rule.recommendation.replace('_', ' ')}</Badge>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">Buy under {money(rule.max_buy_price)} · target {rule.target_margin_percent}% margin</div>
                  {rule.reason && <p className="mt-2 text-xs text-muted-foreground">{rule.reason}</p>}
                </div>
              ))}
              {rules.length === 0 && <div className="rounded-2xl border border-border/40 bg-card p-8 text-center text-sm text-muted-foreground">No buy guide rules yet.</div>}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
            <div className="rounded-2xl border border-border/40 bg-card p-4">
              <h2 className="text-sm font-semibold">Open Dispute Case</h2>
              <div className="mt-4 space-y-3">
                <Select value={disputeForm.inventory_item_id} onValueChange={(value) => setDisputeForm({ ...disputeForm, inventory_item_id: value })}>
                  <SelectTrigger><SelectValue placeholder="Inventory item" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No linked item</SelectItem>
                    {inventory.slice(0, 100).map((item) => <SelectItem key={item.id} value={item.id}>{item.product_name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-3">
                  <Select value={disputeForm.platform} onValueChange={(value) => setDisputeForm({ ...disputeForm, platform: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{['ebay', 'whatnot', 'amazon', 'facebook', 'local', 'manual', 'other'].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={disputeForm.reason} onValueChange={(value) => setDisputeForm({ ...disputeForm, reason: value as DisputeReason })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{['shipping_damage', 'as_is_untested', 'buyer_remorse', 'item_as_described', 'missing_item', 'region_compatibility', 'not_working', 'other'].map((value) => <SelectItem key={value} value={value}>{value.replaceAll('_', ' ')}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Input placeholder="Order reference" value={disputeForm.order_reference} onChange={(e) => setDisputeForm({ ...disputeForm, order_reference: e.target.value })} />
                <Input placeholder="Buyer name" value={disputeForm.buyer_name} onChange={(e) => setDisputeForm({ ...disputeForm, buyer_name: e.target.value })} />
                <Input placeholder="Tracking number" value={disputeForm.tracking_number} onChange={(e) => setDisputeForm({ ...disputeForm, tracking_number: e.target.value })} />
                <Input type="number" placeholder="Claim amount" value={disputeForm.claim_amount} onChange={(e) => setDisputeForm({ ...disputeForm, claim_amount: e.target.value })} />
                <Textarea rows={2} placeholder="Condition notes" value={disputeForm.condition_notes} onChange={(e) => setDisputeForm({ ...disputeForm, condition_notes: e.target.value })} />
                <Textarea rows={2} placeholder="Testing status" value={disputeForm.testing_status} onChange={(e) => setDisputeForm({ ...disputeForm, testing_status: e.target.value })} />
                <Textarea rows={2} placeholder="Packing notes" value={disputeForm.packing_notes} onChange={(e) => setDisputeForm({ ...disputeForm, packing_notes: e.target.value })} />
                <Button className="w-full" onClick={handleCreateDispute} disabled={saving}>Open Case</Button>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {disputes.map((dispute) => (
                <div key={dispute.id} className="rounded-2xl border border-border/40 bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">{dispute.inventory_items?.product_name || dispute.order_reference || 'Dispute Case'}</h3>
                    <Badge variant="outline">{dispute.status.replace('_', ' ')}</Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{dispute.platform} · {dispute.reason.replaceAll('_', ' ')} · {money(dispute.claim_amount)}</div>
                  <Textarea className="mt-3" rows={5} defaultValue={dispute.response_template || disputeResponseTemplate(dispute.reason)} />
                </div>
              ))}
              {disputes.length === 0 && <div className="rounded-2xl border border-border/40 bg-card p-8 text-center text-sm text-muted-foreground">No dispute cases yet.</div>}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-border/30 bg-white/[0.01] p-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Archive className="h-3.5 w-3.5 text-primary" />
            <span>Planning records are saved separately from inventory so they can support reporting and future automation.</span>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
