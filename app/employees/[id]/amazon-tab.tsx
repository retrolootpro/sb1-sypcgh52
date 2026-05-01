'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Package2, ExternalLink, DollarSign } from 'lucide-react';
import {
  createAmazonListing,
  updateAmazonListing,
  getInventoryItemsForListing,
  type AmazonListingWithItem,
} from '@/lib/api-services';
import { toast } from 'sonner';

interface AmazonTabProps {
  employeeId: string;
  listings: AmazonListingWithItem[];
  onRefresh: () => void;
}

const statusColors: Record<string, string> = {
  draft: 'border-border/60 text-muted-foreground',
  active: 'border-emerald-500/30 text-emerald-400',
  sold: 'border-sky-500/30 text-sky-400',
  ended: 'border-amber-500/30 text-amber-400',
  cancelled: 'border-red-500/30 text-red-400',
};

export function AmazonTab({ employeeId, listings, onRefresh }: AmazonTabProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [availableItems, setAvailableItems] = useState<{ id: string; title: string; platform?: string }[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [form, setForm] = useState({
    item_id: '',
    listed_price: '',
    listing_url: '',
    asin: '',
  });
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const openCreate = async () => {
    setLoadingItems(true);
    try {
      const items = await getInventoryItemsForListing();
      setAvailableItems(items);
    } catch {
      toast.error('Failed to load inventory');
    } finally {
      setLoadingItems(false);
    }
    setCreateOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.item_id || !form.listed_price) return;
    setLoading(true);
    try {
      await createAmazonListing({
        item_id: form.item_id,
        employee_id: employeeId,
        listed_price: parseFloat(form.listed_price),
        listing_url: form.listing_url,
        asin: form.asin,
        status: 'draft',
      });
      toast.success('Amazon listing created');
      setForm({ item_id: '', listed_price: '', listing_url: '', asin: '' });
      setCreateOpen(false);
      onRefresh();
    } catch {
      toast.error('Failed to create listing');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (listingId: string, newStatus: string) => {
    setUpdatingId(listingId);
    try {
      const updates: Record<string, unknown> = { status: newStatus };
      if (newStatus === 'sold') updates.sold_at = new Date().toISOString();
      if (newStatus === 'active') updates.listed_at = new Date().toISOString();
      await updateAmazonListing(listingId, updates as Parameters<typeof updateAmazonListing>[1]);
      toast.success('Listing updated');
      onRefresh();
    } catch {
      toast.error('Failed to update listing');
    } finally {
      setUpdatingId(null);
    }
  };

  const totalRevenue = listings
    .filter(l => l.status === 'sold')
    .reduce((sum, l) => sum + (l.listed_price || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Amazon Listings</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {listings.length} listing{listings.length !== 1 ? 's' : ''}
            {totalRevenue > 0 && <span className="ml-2 text-emerald-400">${totalRevenue.toFixed(2)} sold</span>}
          </p>
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={openCreate}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add Listing
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {(['draft', 'active', 'sold', 'ended'] as const).map((s) => {
          const count = listings.filter(l => l.status === s).length;
          return (
            <div key={s} className="rounded-xl border border-border/40 bg-card/50 p-3 text-center">
              <div className="text-lg font-bold">{count}</div>
              <div className="text-[10px] text-muted-foreground capitalize mt-0.5">{s === 'active' ? 'Live' : s}</div>
            </div>
          );
        })}
      </div>

      {listings.length === 0 ? (
        <div className="rounded-xl border border-border/40 bg-card/50 flex flex-col items-center justify-center py-12">
          <Package2 className="w-8 h-8 text-muted-foreground/20 mb-3" />
          <p className="text-sm text-muted-foreground mb-1">No Amazon listings</p>
          <p className="text-xs text-muted-foreground/60">Add a listing to track Amazon sales</p>
        </div>
      ) : (
        <div className="space-y-2">
          {listings.map((listing) => (
            <div key={listing.id} className="rounded-xl border border-border/40 bg-card/50 p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Package2 className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {listing.inventory_items?.title || 'Unknown Item'}
                  </div>
                  {listing.inventory_items?.platform && (
                    <div className="text-xs text-muted-foreground mt-0.5">{listing.inventory_items.platform}</div>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                      <DollarSign className="w-3 h-3" />
                      {listing.listed_price.toFixed(2)}
                    </span>
                    {listing.listing_url && (
                      <a
                        href={listing.listing_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary/70 hover:text-primary flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View on Amazon
                      </a>
                    )}
                    {listing.asin && (
                      <span className="text-xs text-muted-foreground font-mono">ASIN: {listing.asin}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <Badge variant="outline" className={`text-[10px] ${statusColors[listing.status]}`}>
                    {listing.status === 'active' ? 'Live' : listing.status}
                  </Badge>
                  <Select
                    value={listing.status}
                    onValueChange={(val) => handleStatusChange(listing.id, val)}
                    disabled={updatingId === listing.id}
                  >
                    <SelectTrigger className="h-6 text-[10px] w-[90px] border-border/40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="active">Go Live</SelectItem>
                      <SelectItem value="sold">Mark Sold</SelectItem>
                      <SelectItem value="ended">End</SelectItem>
                      <SelectItem value="cancelled">Cancel</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Amazon Listing</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-white/50">Inventory Item</Label>
              <Select
                value={form.item_id}
                onValueChange={(val) => setForm(f => ({ ...f, item_id: val }))}
                disabled={loadingItems}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder={loadingItems ? 'Loading...' : 'Select item...'} />
                </SelectTrigger>
                <SelectContent>
                  {availableItems.map(item => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}{item.platform ? ` — ${item.platform}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-white/50">Listing Price ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.listed_price}
                onChange={(e) => setForm(f => ({ ...f, listed_price: e.target.value }))}
                placeholder="0.00"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-white/50">ASIN (optional)</Label>
              <Input
                value={form.asin}
                onChange={(e) => setForm(f => ({ ...f, asin: e.target.value }))}
                placeholder="e.g. B07XJ8C8F5"
                className="h-9 text-sm font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-white/50">Listing URL (optional)</Label>
              <Input
                value={form.listing_url}
                onChange={(e) => setForm(f => ({ ...f, listing_url: e.target.value }))}
                placeholder="https://amazon.com/dp/..."
                className="h-9 text-sm"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={loading || !form.item_id || !form.listed_price}>
                {loading ? 'Creating...' : 'Create Listing'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
