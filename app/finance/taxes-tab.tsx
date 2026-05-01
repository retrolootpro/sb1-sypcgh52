'use client';

import { useEffect, useState, useCallback } from 'react';
import { CircleAlert as AlertCircle, CircleCheck as CheckCircle2, ChevronDown, ChevronRight, Info, Save, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { getTaxProfile, upsertTaxProfile, getPLStatement, formatCurrency, type TaxProfile } from '@/lib/finance-services';
import { toast } from 'sonner';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

const QUARTERLY_DEADLINES = [
  { quarter: 'Q1', period: 'Jan 1 – Mar 31', due: 'April 15', description: 'First quarter estimated payment' },
  { quarter: 'Q2', period: 'Apr 1 – May 31', due: 'June 16', description: 'Second quarter estimated payment' },
  { quarter: 'Q3', period: 'Jun 1 – Aug 31', due: 'September 15', description: 'Third quarter estimated payment' },
  { quarter: 'Q4', period: 'Sep 1 – Dec 31', due: 'January 15', description: 'Fourth quarter estimated payment (following year)' },
];

const STATES_WITH_INCOME_TAX: Record<string, { rate: string; topRate: number }> = {
  CA: { rate: 'Up to 13.3%', topRate: 0.133 }, NY: { rate: 'Up to 10.9%', topRate: 0.109 },
  NJ: { rate: 'Up to 10.75%', topRate: 0.1075 }, OR: { rate: 'Up to 9.9%', topRate: 0.099 },
  MN: { rate: 'Up to 9.85%', topRate: 0.0985 }, DC: { rate: 'Up to 10.75%', topRate: 0.1075 },
  VT: { rate: 'Up to 8.75%', topRate: 0.0875 }, IA: { rate: 'Up to 6.0%', topRate: 0.06 },
  WI: { rate: 'Up to 7.65%', topRate: 0.0765 }, ME: { rate: 'Up to 7.15%', topRate: 0.0715 },
  SC: { rate: 'Up to 7.0%', topRate: 0.07 }, CT: { rate: 'Up to 6.99%', topRate: 0.0699 },
  IL: { rate: '4.95% flat', topRate: 0.0495 }, IN: { rate: '3.15% flat', topRate: 0.0315 },
  PA: { rate: '3.07% flat', topRate: 0.0307 }, CO: { rate: '4.4% flat', topRate: 0.044 },
  UT: { rate: '4.65% flat', topRate: 0.0465 }, MA: { rate: '5% flat', topRate: 0.05 },
  GA: { rate: 'Up to 5.75%', topRate: 0.0575 }, NC: { rate: '4.75% flat', topRate: 0.0475 },
  VA: { rate: 'Up to 5.75%', topRate: 0.0575 }, OH: { rate: 'Up to 3.99%', topRate: 0.0399 },
  KY: { rate: '4.5% flat', topRate: 0.045 }, AZ: { rate: '2.5% flat', topRate: 0.025 },
  MI: { rate: '4.25% flat', topRate: 0.0425 }, MD: { rate: 'Up to 5.75%', topRate: 0.0575 },
  HI: { rate: 'Up to 11%', topRate: 0.11 }, AR: { rate: 'Up to 4.9%', topRate: 0.049 },
};

const NO_INCOME_TAX_STATES = ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY'];

const FEDERAL_BRACKETS_2024 = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: Infinity, rate: 0.37 },
];

const STANDARD_DEDUCTION_2024 = 14600;

const BUSINESS_TYPE_INFO: Record<string, { label: string; description: string }> = {
  sole_proprietor: {
    label: 'Sole Proprietor',
    description: 'You and your business are the same legal entity. All profit is personal income — simplest structure, no formal setup required. File Schedule C with your 1040.',
  },
  llc_single: {
    label: 'LLC (Single Member)',
    description: 'Provides liability protection. Taxed the same as a sole proprietor by default (Schedule C). You can elect S-Corp taxation if income justifies it.',
  },
  llc_multi: {
    label: 'LLC (Multi Member)',
    description: 'Two or more owners. Taxed as a partnership by default (Form 1065). Each member reports their share on Schedule E.',
  },
  s_corp: {
    label: 'S-Corporation',
    description: 'Pass-through taxation with potential self-employment tax savings. Requires paying yourself a reasonable salary. More complex — recommended when profit exceeds ~$50K.',
  },
  c_corp: {
    label: 'C-Corporation',
    description: 'Separate tax entity at flat 21% corporate rate. Subject to double taxation on dividends. Rarely recommended for small resellers.',
  },
  partnership: {
    label: 'Partnership',
    description: 'Two or more people sharing profit and loss. Files Form 1065; each partner receives a K-1 to report on personal return.',
  },
};

function calculateFederalEffectiveRate(annualProfit: number): {
  taxableIncome: number;
  federalTax: number;
  effectiveRate: number;
  brackets: Array<{ rate: number; amount: number; tax: number }>;
} {
  const taxableIncome = Math.max(0, annualProfit - STANDARD_DEDUCTION_2024);
  let remaining = taxableIncome;
  let federalTax = 0;
  const brackets: Array<{ rate: number; amount: number; tax: number }> = [];

  for (const bracket of FEDERAL_BRACKETS_2024) {
    if (remaining <= 0) break;
    const taxable = Math.min(remaining, bracket.max - bracket.min);
    const tax = taxable * bracket.rate;
    if (taxable > 0) {
      brackets.push({ rate: bracket.rate, amount: taxable, tax });
      federalTax += tax;
    }
    remaining -= taxable;
  }

  const effectiveRate = annualProfit > 0 ? (federalTax / annualProfit) * 100 : 0;
  return { taxableIncome, federalTax, effectiveRate, brackets };
}

function GuidanceCard({ title, icon: Icon, children, defaultOpen = false }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-secondary/20 transition-colors">
        <div className="flex items-center gap-3">
          <Icon className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-white/80">{title}</span>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-5 pb-5 space-y-3 border-t border-border/30 pt-4">{children}</div>}
    </div>
  );
}

function Step({ num, title, description }: { num: number; title: string; description: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-[10px] font-bold text-primary">{num}</span>
      </div>
      <div>
        <div className="text-sm font-medium text-white/80">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</div>
      </div>
    </div>
  );
}

function InfoTooltip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-muted-foreground hover:text-white/60 transition-colors"
      >
        <Info className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-5 top-0 z-50 w-64 rounded-xl border border-border/60 bg-card shadow-xl p-3 text-[11px] text-muted-foreground leading-relaxed">
            <button onClick={() => setOpen(false)} className="absolute top-2 right-2 text-muted-foreground hover:text-white/60"><X className="w-3 h-3" /></button>
            {children}
          </div>
        </>
      )}
    </span>
  );
}

function RateEstimatorPanel({ annualProfit, state, onApply }: {
  annualProfit: number;
  state: string;
  onApply: (rate: string) => void;
}) {
  const { taxableIncome, federalTax, effectiveRate, brackets } = calculateFederalEffectiveRate(annualProfit);
  const stateInfo = STATES_WITH_INCOME_TAX[state];
  const isNoTaxState = NO_INCOME_TAX_STATES.includes(state);
  const stateTaxRate = stateInfo ? stateInfo.topRate * 0.6 : 0;
  const stateTax = annualProfit * stateTaxRate;
  const totalEffective = effectiveRate + (stateTaxRate * 100);
  const suggestedRate = Math.round(Math.min(totalEffective, 50));

  return (
    <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-primary">Rate Estimate for {formatCurrency(annualProfit)} profit</span>
        <Button size="sm" className="h-6 text-[10px] px-2" onClick={() => onApply(String(suggestedRate))}>
          Apply {suggestedRate}%
        </Button>
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] font-medium text-white/50 uppercase tracking-wide">Federal Brackets Applied</div>
        <div className="text-[10px] text-muted-foreground">
          Taxable income: {formatCurrency(taxableIncome)} (after ${STANDARD_DEDUCTION_2024.toLocaleString()} standard deduction)
        </div>
        {brackets.map((b, i) => (
          <div key={i} className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">{(b.rate * 100).toFixed(0)}% on {formatCurrency(b.amount)}</span>
            <span className="text-white/60 tabular-nums">= {formatCurrency(b.tax)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between text-[10px] border-t border-border/30 pt-1 mt-1">
          <span className="font-medium text-white/70">Federal tax</span>
          <span className="text-white/80 tabular-nums font-medium">{formatCurrency(federalTax)} ({effectiveRate.toFixed(1)}% effective)</span>
        </div>
      </div>

      {state && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-white/50 uppercase tracking-wide">State Tax ({state})</div>
          {isNoTaxState ? (
            <div className="text-[10px] text-emerald-400">{state} has no state income tax.</div>
          ) : stateInfo ? (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">{stateInfo.rate} — estimated avg ~{(stateTaxRate * 100).toFixed(1)}%</span>
              <span className="text-white/60 tabular-nums">+{formatCurrency(stateTax)}</span>
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground">Select your state for a more accurate estimate.</div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-primary">Suggested Effective Rate</span>
        <span className="text-base font-bold text-white">{suggestedRate}%</span>
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        This is an estimate only. It does not account for deductions beyond the standard deduction, credits, or other income. A CPA can give you a precise figure.
      </p>
    </div>
  );
}

export function TaxesTab() {
  const now = new Date();
  const [profile, setProfile] = useState<TaxProfile | null>(null);
  const [ytdRevenue, setYtdRevenue] = useState(0);
  const [ytdProfit, setYtdProfit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRateEstimator, setShowRateEstimator] = useState(false);
  const [businessTypeInfo, setBusinessTypeInfo] = useState<string | null>(null);
  const [form, setForm] = useState({
    business_name: '',
    business_type: 'sole_proprietor',
    home_state: '',
    effective_tax_rate: '25',
    tax_year: String(now.getFullYear()),
  });

  const estimatedTax = ytdProfit > 0 ? ytdProfit * (parseFloat(form.effective_tax_rate) / 100) : 0;
  const selfEmploymentTax = ytdProfit > 0 ? Math.min(ytdProfit, 168600) * 0.153 : 0;
  const totalTaxEstimate = estimatedTax + selfEmploymentTax;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prof, pl] = await Promise.all([
        getTaxProfile(),
        getPLStatement(now.getFullYear()),
      ]);
      if (prof) {
        setProfile(prof);
        setForm({
          business_name: prof.business_name || '',
          business_type: prof.business_type || 'sole_proprietor',
          home_state: prof.home_state || '',
          effective_tax_rate: String(prof.effective_tax_rate || 25),
          tax_year: String(prof.tax_year || now.getFullYear()),
        });
      }
      setYtdRevenue(pl.revenue);
      setYtdProfit(pl.netProfit);
    } catch { toast.error('Failed to load tax data'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsertTaxProfile({
        ...(profile ? { id: profile.id } : {}),
        business_name: form.business_name,
        business_type: form.business_type,
        home_state: form.home_state,
        effective_tax_rate: parseFloat(form.effective_tax_rate),
        tax_year: parseInt(form.tax_year),
      });
      toast.success('Tax profile saved');
      load();
    } catch { toast.error('Failed to save'); }
    finally { setSaving(false); }
  };

  const thresholdMet = ytdRevenue >= 5000;
  const selectedBusinessType = BUSINESS_TYPE_INFO[form.business_type];

  if (loading) {
    return <div className="space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="rounded-2xl border border-border/40 bg-card h-20 animate-pulse" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">

          <div className="rounded-2xl border border-border/40 bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white/80">Tax Profile</h3>
              <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={saving}>
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label className="text-[11px] text-white/50">Business Name</Label>
                  <InfoTooltip>
                    <strong className="text-white/70 block mb-1">Business Name</strong>
                    Enter the legal name you use for your reselling business. This can be your personal name (e.g., "John Smith") or a DBA name if you have one. It appears on your Schedule C.
                  </InfoTooltip>
                </div>
                <Input value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))}
                  placeholder="Your business name" className="h-8 text-xs bg-secondary/40" />
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label className="text-[11px] text-white/50">Business Type</Label>
                  <InfoTooltip>
                    <strong className="text-white/70 block mb-1">Business Type</strong>
                    How your business is legally structured affects how you're taxed. Most small resellers are <strong className="text-white/70">Sole Proprietors</strong> — it's the default if you haven't formally registered anything.
                  </InfoTooltip>
                </div>
                <Select value={form.business_type} onValueChange={v => { setForm(f => ({ ...f, business_type: v })); setBusinessTypeInfo(v); }}>
                  <SelectTrigger className="h-8 text-xs bg-secondary/40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(BUSINESS_TYPE_INFO).map(([val, info]) => (
                      <SelectItem key={val} value={val}>{info.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedBusinessType && (
                  <p className="text-[10px] text-muted-foreground leading-relaxed pt-0.5">{selectedBusinessType.description}</p>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label className="text-[11px] text-white/50">Home State</Label>
                  <InfoTooltip>
                    <strong className="text-white/70 block mb-1">Home State</strong>
                    The state where you live and operate your business. This determines your state income tax obligation and sales tax nexus. If your state has no income tax (e.g., FL, TX, WA), you only owe federal taxes.
                  </InfoTooltip>
                </div>
                <Select value={form.home_state} onValueChange={v => setForm(f => ({ ...f, home_state: v }))}>
                  <SelectTrigger className="h-8 text-xs bg-secondary/40"><SelectValue placeholder="Select state" /></SelectTrigger>
                  <SelectContent>
                    {US_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                {form.home_state && NO_INCOME_TAX_STATES.includes(form.home_state) && (
                  <p className="text-[10px] text-emerald-400 pt-0.5">{form.home_state} has no state income tax — you only owe federal taxes.</p>
                )}
              </div>

              <div className="space-y-1 col-span-2 sm:col-span-1">
                <div className="flex items-center gap-1.5">
                  <Label className="text-[11px] text-white/50">Effective Tax Rate (%)</Label>
                  <InfoTooltip>
                    <strong className="text-white/70 block mb-1">What is the Effective Tax Rate?</strong>
                    <p className="mb-2">This is the <em>average</em> percentage of your total income paid in federal income taxes — not your top bracket rate.</p>
                    <p className="mb-2">For example: if you earn $60,000 in profit, you don't pay 22% on all of it. The first $11,600 is taxed at 10%, the next $35,550 at 12%, and only the remainder at 22%. Your <em>effective</em> rate ends up being around 13–15%.</p>
                    <p>Use the <strong className="text-white/70">Suggest Rate</strong> button to get an estimate based on your actual YTD profit.</p>
                  </InfoTooltip>
                </div>
                <div className="flex gap-1.5">
                  <Input type="number" min="0" max="60" value={form.effective_tax_rate}
                    onChange={e => setForm(f => ({ ...f, effective_tax_rate: e.target.value }))}
                    placeholder="25" className="h-8 text-xs bg-secondary/40 flex-1" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-[10px] px-2 border-primary/30 text-primary hover:bg-primary/10 whitespace-nowrap"
                    onClick={() => setShowRateEstimator(!showRateEstimator)}
                  >
                    <Sparkles className="w-3 h-3 mr-1" />
                    Suggest Rate
                  </Button>
                </div>
                {showRateEstimator && ytdProfit > 0 && (
                  <RateEstimatorPanel
                    annualProfit={ytdProfit}
                    state={form.home_state}
                    onApply={(rate) => {
                      setForm(f => ({ ...f, effective_tax_rate: rate }));
                      setShowRateEstimator(false);
                      toast.success(`Applied suggested rate of ${rate}%`);
                    }}
                  />
                )}
                {showRateEstimator && ytdProfit <= 0 && (
                  <div className="mt-2 rounded-xl border border-border/30 bg-secondary/20 p-3 text-[11px] text-muted-foreground">
                    No profit recorded yet. Enter transactions to get an automatic rate suggestion based on your actual earnings.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/40 bg-card p-5">
            <h3 className="text-sm font-semibold text-white/80 mb-4">Quarterly Estimated Taxes ({now.getFullYear()})</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {QUARTERLY_DEADLINES.map((q, i) => {
                const quarterProfit = ytdProfit / 4;
                const quarterTax = quarterProfit > 0 ? (quarterProfit * parseFloat(form.effective_tax_rate) / 100) + (Math.min(quarterProfit, 168600 / 4) * 0.153) : 0;
                const isPast = (i + 1) * 3 < now.getMonth() + 1;
                return (
                  <div key={q.quarter} className={`rounded-xl border p-3 ${isPast ? 'border-border/20 opacity-60' : 'border-primary/20 bg-primary/5'}`}>
                    <div className="text-[10px] font-medium text-primary mb-1">{q.quarter}</div>
                    <div className="text-base font-bold text-white/90 tabular-nums">{formatCurrency(quarterTax)}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">Due {q.due}</div>
                    {isPast && <Badge variant="outline" className="text-[9px] mt-1 border-border/40 text-white/30">Past</Badge>}
                  </div>
                );
              })}
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex gap-2">
                <Info className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-200/70 leading-relaxed">
                  These estimates are based on your YTD net profit of {formatCurrency(ytdProfit)} at {form.effective_tax_rate}% effective rate plus 15.3% self-employment tax. Pay via <strong className="text-amber-200/90">IRS Direct Pay</strong> or EFTPS. Consult a CPA for accurate figures.
                </p>
              </div>
            </div>
          </div>

          <GuidanceCard title="Understanding Your Effective Tax Rate" icon={Info} defaultOpen>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The US tax system is <strong className="text-white/70">progressive</strong> — you pay a lower rate on the first dollars you earn, and a higher rate only on income above each bracket threshold. Your "effective" rate is the average across all brackets.
            </p>
            <div className="rounded-xl border border-border/30 bg-secondary/20 overflow-hidden">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="text-left px-3 py-2 text-white/40 font-medium">Income Range</th>
                    <th className="text-right px-3 py-2 text-white/40 font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {FEDERAL_BRACKETS_2024.map((b, i) => (
                    <tr key={i} className="border-b border-border/20 last:border-0">
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {b.max === Infinity ? `Over $${b.min.toLocaleString()}` : `$${b.min.toLocaleString()} – $${b.max.toLocaleString()}`}
                      </td>
                      <td className="px-3 py-1.5 text-right font-semibold text-white/70">{(b.rate * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              2024 federal brackets for single filers. Standard deduction of $14,600 reduces taxable income before brackets apply. State income tax is added on top of your federal rate.
            </p>
            <Step num={1} title='Use the "Suggest Rate" button' description="Enter your state and click Suggest Rate to get an estimate calculated from your actual YTD profit using real 2024 tax brackets." />
            <Step num={2} title="Add state tax" description="If your state has income tax, the estimator automatically adds an estimated state rate on top of the federal figure." />
            <Step num={3} title="Adjust for your situation" description="If you have significant personal deductions (mortgage interest, dependents, retirement contributions), your effective rate may be lower. When in doubt, round up to be safe." />
          </GuidanceCard>

          <GuidanceCard title="Self-Employment Tax (15.3%)" icon={AlertCircle}>
            <p className="text-xs text-muted-foreground leading-relaxed">
              As a self-employed reseller, you must pay <strong className="text-white/70">self-employment (SE) tax</strong> of 15.3% on your net profit — this covers Social Security (12.4%) and Medicare (2.9%) that an employer would normally split with you.
            </p>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {[
                ['12.4%', 'Social Security', 'On first $168,600 of profit'],
                ['2.9%', 'Medicare', 'On all profit (no cap)'],
                ['0.9%', 'Additional Medicare', 'On profit over $200,000'],
                ['50%', 'SE Tax Deduction', 'Half of SE tax is deductible from income'],
              ].map(([rate, name, note]) => (
                <div key={name} className="rounded-lg border border-border/30 bg-secondary/20 p-2.5">
                  <div className="text-sm font-bold text-primary mb-0.5">{rate}</div>
                  <div className="text-xs font-medium text-white/70">{name}</div>
                  <div className="text-[10px] text-muted-foreground">{note}</div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              SE tax is calculated <em>in addition to</em> your income tax. This is why the total tax burden for self-employed people is higher than for W-2 employees. The quarterly estimates above already include SE tax.
            </p>
          </GuidanceCard>

          <GuidanceCard title="1099-K Threshold & Reporting" icon={AlertCircle} defaultOpen={thresholdMet}>
            <div className={`rounded-xl border p-3 mb-3 ${thresholdMet ? 'border-amber-500/20 bg-amber-500/5' : 'border-border/30 bg-secondary/20'}`}>
              <div className="flex items-center gap-2">
                {thresholdMet
                  ? <AlertCircle className="w-4 h-4 text-amber-400" />
                  : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                <div>
                  <div className="text-xs font-medium text-white/80">
                    YTD Revenue: {formatCurrency(ytdRevenue)}
                    {thresholdMet ? ' — You may receive a 1099-K' : ' — Below $5,000 threshold'}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {thresholdMet
                      ? 'Platforms (eBay, Amazon, Whatnot) are required to issue a 1099-K for transactions over $5,000 in 2024.'
                      : 'The 2024 IRS threshold is $5,000 in gross transactions on any single platform.'}
                  </div>
                </div>
              </div>
            </div>
            <Step num={1} title="Gather 1099-Ks" description="eBay, Amazon, and Whatnot will mail or make available Form 1099-K in January for the prior tax year if you exceed the threshold." />
            <Step num={2} title="Report on Schedule C" description="Report all gross sales on Schedule C (Form 1040) as business income, even if you don't receive a 1099-K. COGS and expenses reduce your taxable income." />
            <Step num={3} title="Keep detailed records" description="Maintain purchase receipts, selling prices, and platform fees for every item. Your RetroLoot Pro data is your record-keeping system." />
          </GuidanceCard>

          <GuidanceCard title="Sales Tax as a Reseller" icon={Info}>
            <p className="text-xs text-muted-foreground leading-relaxed">
              As a reseller, sales tax rules depend on your home state and where your buyers are located (nexus). Most online platforms (eBay, Amazon, Whatnot) collect and remit <strong className="text-white/70">Marketplace Facilitator</strong> taxes on your behalf in most states — you are not responsible for collecting sales tax on those sales.
            </p>
            <Step num={1} title="Get a Reseller Permit" description="Apply for a sales tax permit in your home state. This lets you purchase inventory without paying sales tax (for resale)." />
            <Step num={2} title="Marketplace Facilitator Laws" description="eBay, Amazon, and Whatnot are Marketplace Facilitators in all 50 states. They collect and remit sales tax on marketplace sales — you don't need to. This applies to sales made through their platforms." />
            <Step num={3} title="Direct Sales" description="If you sell directly (your own website, local shows, social media), you may need to collect and remit sales tax yourself depending on nexus in the buyer's state." />
            <Step num={4} title="Economic Nexus Thresholds" description="Most states require you to register for sales tax if you exceed $100,000 in sales OR 200 transactions in that state per year. Keep track of show sales by state." />
          </GuidanceCard>

          <GuidanceCard title="Schedule C Deductions (What You Can Write Off)" icon={CheckCircle2}>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Inventory Cost', 'Cost of games/items purchased for resale (COGS)'],
                ['Shipping & Postage', 'Boxes, tape, labels, postage, USPS/UPS/FedEx'],
                ['Platform Fees', 'eBay, Amazon, Whatnot, PayPal fees'],
                ['Home Office', 'Dedicated space used for your reselling business'],
                ['Vehicle Mileage', 'Trips to thrift stores, post offices, shows (67 cents/mile in 2024)'],
                ['Software & Tools', 'RetroLoot Pro, listing tools, price guides, subscriptions'],
                ['Protective Materials', 'Sleeves, cases, cleaning supplies for inventory'],
                ['Show & Market Fees', 'Table/booth fees, admission costs for sourcing shows'],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-lg border border-border/30 bg-secondary/20 p-2.5">
                  <div className="text-xs font-medium text-white/70 mb-0.5">{title}</div>
                  <div className="text-[10px] text-muted-foreground leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </GuidanceCard>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-border/40 bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white/80">YTD Tax Summary</h3>
            {[
              { label: 'Gross Revenue', value: formatCurrency(ytdRevenue), color: 'text-emerald-400' },
              { label: 'Net Profit', value: formatCurrency(ytdProfit), color: ytdProfit >= 0 ? 'text-emerald-400' : 'text-red-400' },
              { label: 'Income Tax Est.', value: formatCurrency(estimatedTax), color: 'text-amber-400' },
              { label: 'SE Tax Est. (15.3%)', value: formatCurrency(selfEmploymentTax), color: 'text-amber-400' },
              { label: 'Total Tax Est.', value: formatCurrency(totalTaxEstimate), color: 'text-red-400' },
              { label: 'After-Tax Profit', value: formatCurrency(ytdProfit - totalTaxEstimate), color: (ytdProfit - totalTaxEstimate) >= 0 ? 'text-emerald-400' : 'text-red-400' },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{row.label}</span>
                <span className={`text-xs font-semibold tabular-nums ${row.color}`}>{row.value}</span>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-border/40 bg-card p-5">
            <h3 className="text-sm font-semibold text-white/80 mb-3">Key Deadlines</h3>
            <div className="space-y-2">
              {[
                { date: 'Jan 15', label: 'Q4 Estimated Tax' },
                { date: 'Apr 15', label: 'Tax Return Due + Q1 Est.' },
                { date: 'Jun 16', label: 'Q2 Estimated Tax' },
                { date: 'Sep 15', label: 'Q3 Estimated Tax' },
                { date: 'Jan 31', label: '1099s from platforms' },
              ].map(d => (
                <div key={d.date} className="flex items-center justify-between py-1 border-b border-border/20 last:border-0">
                  <span className="text-xs text-muted-foreground">{d.label}</span>
                  <span className="text-xs font-medium text-primary">{d.date}</span>
                </div>
              ))}
            </div>
          </div>

          {form.home_state && STATES_WITH_INCOME_TAX[form.home_state] && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <h3 className="text-xs font-semibold text-amber-300 mb-2">State Income Tax ({form.home_state})</h3>
              <p className="text-xs text-amber-200/70 leading-relaxed">
                {form.home_state} has a state income tax rate of <strong className="text-amber-200">{STATES_WITH_INCOME_TAX[form.home_state].rate}</strong>. This is included in your Suggest Rate calculation. File a state return in addition to your federal return.
              </p>
            </div>
          )}

          {form.home_state && NO_INCOME_TAX_STATES.includes(form.home_state) && (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <h3 className="text-xs font-semibold text-emerald-300 mb-2">No State Income Tax ({form.home_state})</h3>
              <p className="text-xs text-emerald-200/70 leading-relaxed">
                {form.home_state} does not have a state income tax. You only owe federal income taxes, which lowers your overall effective rate.
              </p>
            </div>
          )}

          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <h3 className="text-xs font-semibold text-primary mb-2">Disclaimer</h3>
            <p className="text-[11px] text-white/40 leading-relaxed">
              This information is for general guidance only and does not constitute tax advice. Consult a licensed CPA or tax professional for advice specific to your situation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
