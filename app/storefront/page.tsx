'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, RefreshCw, Search, Store } from 'lucide-react';
import Image from 'next/image';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import type { ShippingPromotionMode } from '@/lib/storefront-shipping-promotion';

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
  storefront_shipping_promotion: ShippingPromotionMode;
};

export default function StorefrontManagerPage() {
  const { user, accountId } = useAuth();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string,number>>({});
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (!user || !accountId) return;
    setLoading(true);
    setLoadError('');
    try {
      const rows:StoreItem[]=[];
      for(let offset=0;;offset+=500){
        const {data,error}=await supabase.from('inventory_items')
          .select('id,product_name,console,condition,quantity,status,image_url,thumbnail_url,category,item_type,storefront_enabled,storefront_price,storefront_featured,storefront_category,storefront_description,storefront_updated_at,storefront_shipping_promotion')
          .eq('user_id',accountId).order('product_name').order('id').range(offset,offset+499);
        if(error)throw error;
        rows.push(...(data||[]) as StoreItem[]);
        if(!data||data.length<500)break;
      }
      const response=await fetch('/api/storefront/catalog',{cache:'no-store'});
      const catalog=await response.json();
      if(!response.ok||!catalog.success)throw new Error(catalog.message||'Public catalog could not load.');
      setItems(rows);
      setLivePrices(Object.fromEntries(catalog.products.map((item:{id:string;price:number})=>[item.id,item.price])));
    } catch(cause) {
      const message=cause instanceof Error?cause.message:'Storefront inventory could not load.';
      console.error('Storefront manager:',cause);setLoadError(message);toast.error(message);
    } finally {setLoading(false);}
  }, [user, accountId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      const active = !['sold', 'archived', 'deleted','reserved'].includes(item.status || 'available') && item.quantity > 0;
      const matchesQuery = !q || `${item.product_name} ${item.console} ${item.condition}`.toLowerCase().includes(q);
      return active && matchesQuery;
    });
  }, [items, query]);

  const patchItem = async (id: string, patch: Partial<StoreItem>) => {
    setSaving(id);
    const { error } = await supabase
      .from('inventory_items')
      .update({ ...patch, storefront_updated_at: new Date().toISOString() })
      .eq('id', id).eq('user_id',accountId);
    setSaving(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    await load();
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-5 sm:p-7 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="label-caps mb-1">Online Store</div>
            <h1 className="heading-lg text-[22px]">Pixel & Page Storefront</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              All active, priced inventory from the configured Pixel & Page account appears online. Live quantities and condition pricing sync directly from RetroLoot; an online price override takes priority. Only the public storefront description is shared, never internal notes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href="/storefront/shipping">Shipping & packages</Link></Button>
            <Button asChild variant="outline"><Link href="/storefront/requests">Requests & invoices</Link></Button>
            <Button asChild variant="outline">
              <Link href="/shop" target="_blank"><ExternalLink className="mr-2 h-4 w-4" />View Store</Link>
            </Button>
            <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border/50 bg-card p-5"><div className="label-caps">Live priced products</div><div className="mt-1 text-2xl font-bold">{Object.keys(livePrices).length}</div></div>
          <div className="rounded-2xl border border-border/50 bg-card p-5"><div className="label-caps">Eligible Inventory</div><div className="mt-1 text-2xl font-bold">{items.filter((item) => item.quantity > 0 && !['sold','archived','deleted'].includes(item.status || 'available')).length}</div></div>
          <div className="rounded-2xl border border-border/50 bg-card p-5"><div className="label-caps">Public URL</div><Link className="mt-1 block text-sm font-semibold text-primary" href="/shop">retrolootpro.com/shop</Link></div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border/50 bg-card p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search inventory" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        </div>

        {loadError&&<p role="alert" className="rounded border border-red-500 p-4">{loadError}</p>}
        <div className="overflow-hidden rounded-2xl border border-border/50 bg-card">
          <div className="hidden gap-4 border-b border-border/50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_85px_130px]">
            <span>Product</span><span>Live Qty</span><span>Online Price</span>
          </div>
          {loading ? <div className="p-12 text-center text-sm text-muted-foreground">Loading storefront inventory…</div> : filtered.map((item) => {
            const price = livePrices[item.id] || 0;
            return (
              <div key={item.id} className="grid items-center gap-4 border-b border-border/30 px-5 py-4 last:border-0 sm:grid-cols-[minmax(0,1fr)_85px_130px]">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-secondary/40">
                    {item.thumbnail_url || item.image_url ? <Image className="h-full w-full object-cover" src={item.thumbnail_url || item.image_url || ''} alt="" width={56} height={56} unoptimized/> : <div className="grid h-full w-full place-items-center"><Store className="h-5 w-5 text-muted-foreground" /></div>}
                  </div>
                  <div className="min-w-0"><div className="truncate font-semibold">{item.product_name}</div><div className="truncate text-xs text-muted-foreground">{item.console} • {item.condition}</div><label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={item.storefront_featured} onCheckedChange={(checked) => patchItem(item.id, { storefront_featured: checked })} />Featured</label>
                    <label className="mt-2 block text-xs">Shipping offer<select aria-label={`Shipping offer for ${item.product_name}`} className="mt-1 w-full rounded border bg-background p-2" disabled={saving===item.id} value={item.storefront_shipping_promotion} onChange={event=>{const value=event.target.value;if(value==='eligible'||value==='free'||value==='excluded')patchItem(item.id,{storefront_shipping_promotion:value});}}>
                      <option value="eligible">Eligible on $50+ orders</option><option value="free">Individual free-shipping offer</option><option value="excluded">Excluded from free shipping</option>
                    </select></label><p className="mt-1 text-xs text-muted-foreground">Subject to real standard postage of $8 or less and 15% of eligible merchandise value. Individual offers waive only the $50 minimum.</p>
                  </div>
                </div>
                <div><div className="text-lg font-bold">{item.quantity}</div><div className="text-xs text-muted-foreground">{item.status || 'available'}</div></div>
                <label className="relative"><span className="sr-only">Online price for {item.product_name}</span><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span><Input key={`${item.id}-${price}`} className="pl-7" type="number" min="0" max="100000" step="0.01" disabled={saving===item.id} defaultValue={price || ''} onBlur={(event) => {const value=Number(event.target.value);if(!Number.isFinite(value)||value<0||value>100000){toast.error('Enter a valid price from 0 to 100000.');return;}if(value!==price)patchItem(item.id,{storefront_price:value||null});}} /></label>
              </div>
            );
          })}
          {!loading && filtered.length === 0 && <div className="p-12 text-center text-sm text-muted-foreground">No matching active inventory.</div>}
        </div>
      </div>
    </DashboardLayout>
  );
}
