'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Eye, EyeOff, RefreshCw, Search, Sparkles, Store } from 'lucide-react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';

type StoreItem = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  quantity: number;
  status?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  category?: string | null;
  item_type?: string | null;
  selected_market_value?: number | null;
  price_loose?: number | null;
  price_cib?: number | null;
  price_new?: number | null;
  storefront_enabled: boolean;
  storefront_price?: number | null;
  storefront_compare_at_price?: number | null;
  storefront_featured: boolean;
  storefront_category?: string | null;
  storefront_description?: string | null;
  storefront_updated_at?: string | null;
};

const suggestedPrice = (item: StoreItem) => Number(
  item.storefront_price || item.selected_market_value || item.price_cib || item.price_loose || item.price_new || 0
);

export default function StorefrontManagerPage() {
  const { user, accountId } = useAuth();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [showPublishedOnly, setShowPublishedOnly] = useState(false);

  const load = useCallback(async () => {
    if (!user || !accountId) return;
    setLoading(true);
    const [{ data, error }] = await Promise.all([
      supabase
        .from('inventory_items')
        .select('id,product_name,console,condition,quantity,status,image_url,thumbnail_url,category,item_type,selected_market_value,price_loose,price_cib,price_new,storefront_enabled,storefront_price,storefront_compare_at_price,storefront_featured,storefront_category,storefront_description,storefront_updated_at')
        .eq('user_id', accountId)
        .order('product_name'),
      supabase.from('storefront_settings').upsert({
        user_id: accountId,
        public_slug: 'pixel-and-page',
        store_name: 'Pixel & Page',
        tagline: 'Every Story Has a Save Point',
        logo_path: '/pixel-page-logo.svg',
      }, { onConflict: 'user_id', ignoreDuplicates: true }),
    ]);
    if (error) toast.error(error.message);
    setItems((data || []) as StoreItem[]);
    setLoading(false);
  }, [user, accountId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      const active = !['sold', 'archived', 'deleted'].includes(item.status || 'available') && item.quantity > 0;
      const matchesQuery = !q || `${item.product_name} ${item.console} ${item.condition}`.toLowerCase().includes(q);
      return active && matchesQuery && (!showPublishedOnly || item.storefront_enabled);
    });
  }, [items, query, showPublishedOnly]);

  const publishedCount = items.filter((item) => item.storefront_enabled && item.quantity > 0 && !['sold', 'archived', 'deleted'].includes(item.status || 'available')).length;

  const patchItem = async (id: string, patch: Partial<StoreItem>) => {
    setSaving(id);
    const { error } = await supabase
      .from('inventory_items')
      .update({ ...patch, storefront_updated_at: new Date().toISOString() })
      .eq('id', id);
    setSaving(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const publishAllPriced = async () => {
    if (!accountId) return;
    const eligible = items.filter((item) => item.quantity > 0 && !['sold', 'archived', 'deleted'].includes(item.status || 'available') && suggestedPrice(item) > 0);
    if (!eligible.length) return;
    setSaving('bulk');
    for (const item of eligible) {
      await supabase.from('inventory_items').update({
        storefront_enabled: true,
        storefront_price: suggestedPrice(item),
        storefront_category: item.storefront_category || item.category || item.item_type || 'Other',
        storefront_updated_at: new Date().toISOString(),
      }).eq('id', item.id);
    }
    setSaving(null);
    toast.success(`${eligible.length} priced items published`);
    load();
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-5 sm:p-7 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="label-caps mb-1">Online Store</div>
            <h1 className="heading-lg text-[22px]">Pixel & Page Storefront</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              RetroLootPro is the source of truth. Published products use your live quantity, photos, condition, and pricing data and automatically disappear when sold out.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/shop" target="_blank"><ExternalLink className="mr-2 h-4 w-4" />View Store</Link>
            </Button>
            <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
            <Button onClick={publishAllPriced} disabled={saving === 'bulk'}><Sparkles className="mr-2 h-4 w-4" />Publish All Priced</Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border/50 bg-card p-5"><div className="label-caps">Published</div><div className="mt-1 text-2xl font-bold">{publishedCount}</div></div>
          <div className="rounded-2xl border border-border/50 bg-card p-5"><div className="label-caps">Eligible Inventory</div><div className="mt-1 text-2xl font-bold">{items.filter((item) => item.quantity > 0 && !['sold','archived','deleted'].includes(item.status || 'available')).length}</div></div>
          <div className="rounded-2xl border border-border/50 bg-card p-5"><div className="label-caps">Public URL</div><Link className="mt-1 block text-sm font-semibold text-primary" href="/shop">retrolootpro.com/shop</Link></div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border/50 bg-card p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search inventory" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={showPublishedOnly} onCheckedChange={setShowPublishedOnly} />Published only</label>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/50 bg-card">
          <div className="grid grid-cols-[minmax(260px,1fr)_110px_150px_110px] gap-4 border-b border-border/50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Product</span><span>Live Qty</span><span>Online Price</span><span>Publish</span>
          </div>
          {loading ? <div className="p-12 text-center text-sm text-muted-foreground">Loading storefront inventory…</div> : filtered.map((item) => {
            const price = suggestedPrice(item);
            return (
              <div key={item.id} className="grid grid-cols-[minmax(260px,1fr)_110px_150px_110px] items-center gap-4 border-b border-border/30 px-5 py-4 last:border-0">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-secondary/40">
                    {item.thumbnail_url || item.image_url ? <img className="h-full w-full object-cover" src={item.thumbnail_url || item.image_url || ''} alt="" /> : <div className="grid h-full w-full place-items-center"><Store className="h-5 w-5 text-muted-foreground" /></div>}
                  </div>
                  <div className="min-w-0"><div className="truncate font-semibold">{item.product_name}</div><div className="truncate text-xs text-muted-foreground">{item.console} • {item.condition}</div><label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={item.storefront_featured} onCheckedChange={(checked) => patchItem(item.id, { storefront_featured: checked })} />Featured</label></div>
                </div>
                <div><div className="text-lg font-bold">{item.quantity}</div><div className="text-xs text-muted-foreground">{item.status || 'available'}</div></div>
                <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span><Input className="pl-7" type="number" min="0" step="0.01" defaultValue={price || ''} onBlur={(event) => patchItem(item.id, { storefront_price: Number(event.target.value) || null })} /></div>
                <div className="flex items-center gap-2"><Switch checked={item.storefront_enabled} disabled={saving === item.id || price <= 0} onCheckedChange={(checked) => patchItem(item.id, { storefront_enabled: checked, storefront_price: price || null, storefront_category: item.storefront_category || item.category || item.item_type || 'Other' })} />{item.storefront_enabled ? <Eye className="h-4 w-4 text-emerald-400" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}</div>
              </div>
            );
          })}
          {!loading && filtered.length === 0 && <div className="p-12 text-center text-sm text-muted-foreground">No matching active inventory.</div>}
        </div>
      </div>
    </DashboardLayout>
  );
}
