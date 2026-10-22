'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { z } from 'zod';
import { ArrowRight, ExternalLink, RefreshCw, Search, Store } from 'lucide-react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import type { ShippingPromotionMode } from '@/lib/storefront-shipping-promotion';
import { isStorefrontStock, matchesPublishingFilter, parseStorefrontPrice, type PublishingFilter } from '@/lib/storefront-publishing';

type StoreItem = {
  id: string; product_name: string; console: string; condition: string; quantity: number; status?: string | null;
  image_url?: string | null; thumbnail_url?: string | null; storefront_price?: number | null;
  storefront_featured: boolean; storefront_shipping_promotion: ShippingPromotionMode;
};
type StorePatch = Partial<Pick<StoreItem, 'storefront_price' | 'storefront_featured' | 'storefront_shipping_promotion'>>;
const catalogSchema = z.object({ success: z.literal(true), products: z.array(z.object({
  id: z.string(), price: z.number().positive().finite(), slug: z.string(),
})) });
const filters: { value: PublishingFilter; label: string }[] = [
  { value: 'all', label: 'All available' }, { value: 'live', label: 'Live in shop' },
  { value: 'needs-price', label: 'Needs online price' }, { value: 'needs-photo', label: 'Needs public photo' },
  { value: 'shipping-excluded', label: 'Shipping excluded' },
];
const pageSize = 24;

function PriceEditor({ item, livePrice, disabled, onSave }: {
  item: StoreItem; livePrice?: number; disabled: boolean; onSave: (patch: StorePatch) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(item.storefront_price ? item.storefront_price.toFixed(2) : '');
  const [error, setError] = useState('');
  useEffect(() => { setDraft(item.storefront_price ? item.storefront_price.toFixed(2) : ''); setError(''); }, [item.id, item.storefront_price]);
  return <form className="publishing-price-editor" aria-label={`Pricing for ${item.product_name}`} onSubmit={async event => {
    event.preventDefault();
    setError('');
    try { await onSave({ storefront_price: parseStorefrontPrice(draft) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Enter a valid online price.'); }
  }}>
    <div className="publishing-live-price"><span>Current shop price</span><strong>{livePrice ? `$${livePrice.toFixed(2)}` : 'Not live'}</strong>
      <small>{item.storefront_price ? 'Online override' : livePrice ? 'Automatic condition price' : 'Add an override or refresh inventory pricing.'}</small></div>
    <label>Online price override<Input aria-label={`Online price for ${item.product_name}`} inputMode="decimal" value={draft} disabled={disabled} placeholder="e.g. 24.95" onChange={event => { setDraft(event.target.value); setError(''); }} /></label>
    <div className="flex flex-wrap gap-2"><Button size="sm" type="submit" disabled={disabled || draft === (item.storefront_price ? item.storefront_price.toFixed(2) : '')}>Save price</Button>
      {item.storefront_price != null && <Button size="sm" variant="outline" type="button" disabled={disabled} onClick={() => onSave({ storefront_price: null })}>Use automatic price</Button>}</div>
    <small>Prices change only when saved. Automatic pricing may leave an item off the shop if no usable condition price exists.</small>
    {error && <p role="alert" className="publishing-field-error">{error}</p>}
  </form>;
}

export default function StorefrontManagerPage() {
  const { user, accountId } = useAuth();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PublishingFilter>('all');
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, { price: number; slug: string }>>({});
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const generation = useRef({});
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    const current = {};
    generation.current = current;
    setLoading(true); setLoadError('');
    if (!user || !accountId) { setItems([]); setLive({}); setLoading(false); return; }
    try {
      const rows: StoreItem[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from('inventory_items')
          .select('id,product_name,console,condition,quantity,status,image_url,thumbnail_url,storefront_price,storefront_featured,storefront_shipping_promotion')
          .eq('user_id', accountId).order('product_name').order('id').range(offset, offset + 499);
        if (error) throw error;
        if (!data) throw new Error('Storefront inventory response was missing.');
        if (generation.current !== current) return;
        rows.push(...data);
        if (data.length < 500) break;
      }
      const response = await fetch('/api/storefront/catalog', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Public catalog could not load.');
      const catalog = catalogSchema.parse(result);
      if (generation.current !== current) return;
      setItems(rows);
      setLive(Object.fromEntries(catalog.products.map(item => [item.id, { price: item.price, slug: item.slug }])));
    } catch (cause) {
      console.error('Storefront manager:', cause);
      if (generation.current === current) { setItems([]); setLive({}); setLoadError('Storefront inventory and live prices could not be verified. Retry before making changes.'); }
    } finally { if (generation.current === current) setLoading(false); }
  }, [user, accountId]);
  useEffect(() => { void load(); return () => { generation.current = {}; }; }, [load]);

  const livePrices = useMemo(() => Object.fromEntries(Object.entries(live).map(([id, product]) => [id, product.price])), [live]);
  const counts = useMemo(() => Object.fromEntries(filters.map(option => [option.value, items.filter(item => matchesPublishingFilter(item, livePrices, option.value)).length])), [items, livePrices]);
  const filtered = useMemo(() => items.filter(item => matchesPublishingFilter(item, livePrices, filter)
    && `${item.product_name} ${item.console} ${item.condition}`.toLowerCase().includes(query.trim().toLowerCase())), [items, livePrices, filter, query]);
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const disabled = loading || saving !== null || !!loadError;
  const patchItem = async (id: string, patch: StorePatch) => {
    if (!accountId || !user || disabled || savingRef.current) return false;
    savingRef.current = true; setSaving(id); setSaveError('');
    try {
      const { data, error } = await supabase.from('inventory_items')
        .update({ ...patch, storefront_updated_at: new Date().toISOString() })
        .eq('id', id).eq('user_id', accountId).select('id').single();
      if (error) throw error;
      if (!data) throw new Error('The item could not be updated. Check team access and retry.');
      toast.success('Storefront change saved. Checking the live catalog...');
      await load();
      return true;
    } catch (cause) {
      console.error('Storefront save:', cause);
      const message = 'This storefront change could not be confirmed. Refresh to check the saved value before retrying.';
      setSaveError(message); toast.error(message);
      return false;
    } finally { savingRef.current = false; setSaving(null); }
  };

  return <DashboardLayout><div className="publishing-workspace space-y-6 p-4 sm:p-7">
    <header className="catalog-workspace-header"><div><p className="brand-eyebrow">FROM INVENTORY TO THE SHOP</p>
      <h1>Build a shelf worth exploring.</h1><p>Review live prices, feature your favorites, and spot the items that need a little more care.</p></div>
      <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/business/inventory">Inventory <ArrowRight size={16} className="ml-2"/></Link></Button>
        <Button asChild variant="outline"><Link href="/" target="_blank" rel="noopener noreferrer"><ExternalLink size={16} className="mr-2"/>View shop</Link></Button>
        <Button variant="outline" onClick={load} disabled={loading || saving !== null}><RefreshCw size={16} className="mr-2"/>Refresh catalog</Button></div></header>
    <aside className="publishing-policy"><Store size={22}/><div><strong>Available + priced = live in your shop.</strong>
      <p>Publication is automatic for available, priced inventory in this company account. There is no new publish/unpublish switch. Saved online overrides take priority over automatic condition prices. Only public descriptions are shared, never internal notes.</p>
      <Link href="/business/orders">Orders & requests</Link><Link href="/business/storefront/shipping">Shipping & packages</Link></div></aside>
    {saveError && <p role="alert" className="staff-access-error">{saveError}</p>}
    {loadError ? <section className="business-overview-message"><p role="alert">{loadError}</p><Button variant="outline" onClick={load}>Retry storefront inventory</Button></section>
      : loading ? <p role="status" className="business-overview-message">Checking available inventory and live shop prices...</p> : <>
        <nav className="publishing-filters" aria-label="Publishing queues">{filters.map(option => <button key={option.value} disabled={saving !== null} aria-pressed={filter === option.value} onClick={() => { setFilter(option.value); setPage(0); }}>
          <span>{option.label}</span><strong>{counts[option.value].toLocaleString()}</strong></button>)}</nav>
        <div className="publishing-search"><label><Search size={18}/><span className="sr-only">Search publishing inventory</span><Input aria-label="Search publishing inventory" placeholder="Search by title, platform or condition" value={query} disabled={saving !== null} onChange={event => { setQuery(event.target.value); setPage(0); }}/></label>
          <p>{filtered.length.toLocaleString()} matching records. Photo checks use the public image, not an internal thumbnail.</p></div>
        <section className="publishing-products" aria-label="Storefront inventory">
          {visible.map(item => <article key={item.id} aria-label={item.product_name} className="publishing-product">
            <div className="publishing-product-details"><div className="publishing-product-title">
              <div className="publishing-photo">{item.image_url ? <Image src={item.image_url} width={64} height={64} alt="" unoptimized/> : <Store size={26}/>}</div>
              <div className="min-w-0"><Link className="publishing-item-title" href={`/business/inventory/${item.id}`}>{item.product_name}</Link><p>{item.console} · {item.condition}</p>
                <div className="publishing-badges"><span className={live[item.id] ? 'is-live' : 'needs-attention'}>{live[item.id] ? 'Live in shop' : 'Needs online price'}</span>{!item.image_url && <span className="needs-attention">Needs public photo</span>}</div></div>
            </div><div className="publishing-item-actions"><span>{item.quantity} available</span>
              {live[item.id] && <Link href={`/shop/product/${live[item.id].slug}`} target="_blank" rel="noopener noreferrer">View product <ExternalLink size={13}/></Link>}
              <Link href={`/business/inventory/${item.id}`}>Photos & item details <ArrowRight size={13}/></Link></div>
              <label className="publishing-feature"><Switch aria-label={`Feature ${item.product_name}`} disabled={disabled} checked={item.storefront_featured} onCheckedChange={checked => patchItem(item.id, { storefront_featured: checked })}/>Feature this find <small>Highlight in staff picks</small></label>
              <label className="publishing-shipping">Shipping offer<select aria-label={`Shipping offer for ${item.product_name}`} disabled={disabled} value={item.storefront_shipping_promotion} onChange={event => {
                const value = event.target.value;
                if (value === 'eligible' || value === 'free' || value === 'excluded') void patchItem(item.id, { storefront_shipping_promotion: value });
              }}><option value="eligible">Automatically eligible - no minimum</option><option value="free">Individual offer (same postage limits)</option><option value="excluded">Excluded from free shipping</option></select></label>
              <p className="publishing-shipping-note">{item.storefront_shipping_promotion === 'excluded' ? 'Excluded packages pay normal shipping.' : 'Eligible, not guaranteed: covered standard postage must total $8 or less and no more than 15% of covered merchandise value. No purchase minimum.'}</p>
            </div>
            <PriceEditor item={item} livePrice={live[item.id]?.price} disabled={disabled} onSave={patch => patchItem(item.id, patch)}/>
          </article>)}
          {!visible.length && <div className="business-overview-message"><h2>No items in this view.</h2><p>{items.some(isStorefrontStock) ? 'Try another queue or search. No inventory has been changed.' : 'Scan or add inventory to start building your shop.'}</p><Link href="/business/scan">Scan & add inventory</Link></div>}
        </section>
        <nav className="publishing-pagination" aria-label="Publishing pages"><Button variant="outline" disabled={currentPage === 0 || saving !== null} onClick={() => setPage(currentPage - 1)}>Previous</Button>
          <span>Page {currentPage + 1} of {lastPage + 1} · up to {pageSize} items</span><Button variant="outline" disabled={currentPage >= lastPage || saving !== null} onClick={() => setPage(currentPage + 1)}>Next</Button></nav>
      </>}
  </div></DashboardLayout>;
}
