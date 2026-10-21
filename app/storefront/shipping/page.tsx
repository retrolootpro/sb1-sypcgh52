'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { shippingSettingsSchema, type PackageProfile, type ShippingCustomer } from '@/lib/storefront-shipping';

const emptyOrigin: ShippingCustomer = { name: '', email: '', address: { line1: '', line2: '', city: '', state: '', postal_code: '', country: 'US' } };
type ProfileDraft = Omit<PackageProfile, 'unitWeightOz' | 'packagingWeightOz' | 'lengthIn' | 'widthIn' | 'heightIn' | 'unitsPerParcel'> & {
  unitWeightOz: string; packagingWeightOz: string; lengthIn: string; widthIn: string; heightIn: string; unitsPerParcel: string;
};
const measurements = [
  ['unitWeightOz', 'Item weight (oz)'], ['packagingWeightOz', 'Empty packaging weight (oz)'],
  ['lengthIn', 'Packed length (in)'], ['widthIn', 'Packed width (in)'], ['heightIn', 'Packed height (in)'], ['unitsPerParcel', 'Items fitting this package'],
] as const;
const inputClass = 'mt-1 w-full rounded-md border bg-background p-3';

export default function ShippingSettingsPage() {
  const { accountId, isAdmin } = useAuth();
  const [origin, setOrigin] = useState(emptyOrigin);
  const [profiles, setProfiles] = useState<ProfileDraft[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connection, setConnection] = useState<{ stripeMode: string; shippoMode: string; taxStatus: string; carriers: string[]; missingCarriers: string[]; message: string } | null>(null);
  async function api(body?: unknown) {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) throw new Error('Sign in to configure shipping.');
    const response = await fetch('/api/storefront/shipping', { method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'Shipping configuration could not be saved.');
    return result;
  }
  useEffect(() => {
    if (!accountId || !isAdmin) { setLoading(false); return; }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [result, response] = await Promise.all([api(), fetch('/api/storefront/catalog', { cache: 'no-store' })]);
        const catalog = await response.json();
        if (!response.ok || !catalog.success) throw new Error(catalog.message || 'Catalog could not load.');
        if (cancelled) return;
        const parsed = shippingSettingsSchema.safeParse(result.settings);
        if (result.settings && !parsed.success) throw new Error('Saved shipping settings are invalid. Contact support.');
        if (parsed.success) {
          setOrigin(parsed.data.origin);
          setProfiles(parsed.data.profiles.map(p => ({ ...p, unitWeightOz: String(p.unitWeightOz), packagingWeightOz: String(p.packagingWeightOz),
            lengthIn: String(p.lengthIn), widthIn: String(p.widthIn), heightIn: String(p.heightIn), unitsPerParcel: String(p.unitsPerParcel) })));
        }
        setCategories(Array.from(new Set<string>(catalog.products.map((p: { category: string }) => p.category))).sort());
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Shipping settings could not load.'); }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [accountId, isAdmin]);
  const save = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const settings = shippingSettingsSchema.parse({ origin, profiles: profiles.map(p => ({ ...p,
        ...Object.fromEntries(measurements.map(([key]) => [key, p[key] === '' ? NaN : Number(p[key])])) })) });
      await api({ action: 'save', settings });
      setNotice('Shipping settings saved. New quotes use these profiles. Existing accepted orders keep their original quote.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Shipping settings could not be saved.'); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setError(''); setConnection(null);
    try { setConnection(await api({ action: 'verify' })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Service connection check failed.'); }
    finally { setBusy(false); }
  };
  return <DashboardLayout><div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-7">
    <header className="space-y-3"><h1 className="text-2xl font-bold">Shipping & package profiles</h1>
      <p>US-only live USPS, UPS and FedEx quotes through Shippo. No labels are purchased here. Enable carriers in Shippo; quotes can differ from Pirate Ship label prices.</p>
      <Button asChild variant="outline"><Link href="/storefront">Back to Storefront Manager</Link></Button></header>
    {!isAdmin ? <p role="alert">Store administrator access is required.</p> : loading ? <p role="status">Loading shipping settings...</p> : <>
      {error && <p role="alert" className="whitespace-pre-wrap rounded border border-red-500 p-4 text-red-500">{error}</p>}
      {notice && <p role="status" className="rounded border p-4">{notice}</p>}
      <section className="space-y-3 rounded-xl border bg-card p-5"><h2 className="text-xl font-semibold">Stripe & Shippo connection</h2>
        <Button disabled={busy} variant="outline" onClick={verify}>Check service connections</Button>
        {connection && <div role="status" className="space-y-2"><p>Stripe: {connection.stripeMode} · Shippo: {connection.shippoMode} · Stripe Tax: {connection.taxStatus}</p>
          <p>Enabled carriers: {connection.carriers.join(', ') || 'None'}</p>
          {!!connection.missingCarriers.length && <p>Not enabled: {connection.missingCarriers.join(', ')}. Activate them directly in Shippo.</p>}
          <p className="text-sm text-muted-foreground">{connection.message}</p></div>}
      </section>
      <fieldset disabled={busy} className="space-y-5">
        <section className="space-y-4 rounded-xl border bg-card p-5"><h2 className="text-xl font-semibold">Ship-from / return address</h2>
          <p className="text-sm text-muted-foreground">Enter the actual dispatch address. It is used server-side for carrier quotes and is not published in the catalog.</p>
          <div className="grid gap-4 sm:grid-cols-2">{(['name', 'email'] as const).map(key => <label key={key}>{key === 'name' ? 'Sender name' : 'Sender email'}<input className={inputClass} value={origin[key]} onChange={e => setOrigin({ ...origin, [key]: e.target.value })}/></label>)}
            {(['line1', 'line2', 'city', 'state', 'postal_code'] as const).map(key => <label key={key}>{({ line1: 'Address line 1', line2: 'Address line 2', city: 'City', state: 'State (2 letters)', postal_code: 'ZIP code' })[key]}<input className={inputClass} value={origin.address[key]} onChange={e => setOrigin({ ...origin, address: { ...origin.address, [key]: e.target.value } })}/></label>)}
            <p className="self-end p-3">Country: United States</p></div>
        </section>
        <section className="space-y-4"><h2 className="text-xl font-semibold">Package profiles by item type</h2>
          <p>Measure real packaging; no weights or prices are assumed. The most specific category/platform/condition match wins. Items sharing a profile share packages up to its capacity; different profiles ship separately. Use capacity 1 unless the listed box safely fits multiple items. Ineligible Media Mail services are excluded.</p>
          <datalist id="shipping-categories">{categories.map(value => <option key={value} value={value}/>)}</datalist>
          {profiles.map((p, index) => <article className="space-y-4 rounded-xl border bg-card p-5" key={p.id}>
            <div className="flex items-center justify-between gap-3"><h3 className="font-bold">Profile {index + 1}</h3><Button variant="outline" onClick={() => setProfiles(profiles.filter(row => row.id !== p.id))}>Remove profile</Button></div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{(['name', 'category', 'platform', 'condition'] as const).map(key => <label key={key}>{({ name: 'Profile name', category: 'Exact catalog category', platform: 'Platform / format (optional)', condition: 'Condition (optional)' })[key]}<input list={key === 'category' ? 'shipping-categories' : undefined} className={inputClass} value={p[key]} onChange={e => setProfiles(profiles.map(row => row.id === p.id ? { ...row, [key]: e.target.value } : row))}/></label>)}
              {measurements.map(([key, label]) => <label key={key}>{label}<input type="number" min={key === 'packagingWeightOz' ? 0 : key === 'unitsPerParcel' ? 1 : 0.001} step={key === 'unitsPerParcel' ? 1 : 0.001} className={inputClass} value={p[key]} onChange={e => setProfiles(profiles.map(row => row.id === p.id ? { ...row, [key]: e.target.value } : row))}/></label>)}</div>
          </article>)}
          {!profiles.length && <p role="status">No package profiles configured. Shipping checkout is unavailable until staff enter valid measurements.</p>}
          <Button variant="outline" onClick={() => setProfiles([...profiles, { id: crypto.randomUUID(), name: '', category: '', platform: '', condition: '',
            unitWeightOz: '', packagingWeightOz: '', lengthIn: '', widthIn: '', heightIn: '', unitsPerParcel: '1' }])}>Add package profile</Button>
        </section>
        <Button disabled={!profiles.length} onClick={save}>{busy ? 'Saving...' : 'Save shipping settings'}</Button>
      </fieldset>
    </>}
  </div></DashboardLayout>;
}
