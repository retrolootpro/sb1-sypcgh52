'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Truck, PackageCheck, Package, DollarSign, CheckCheck } from 'lucide-react';
import {
  markItemShipped,
  markItemShippingPending,
  type InventoryItemShipping,
} from '@/lib/api-services';
import { toast } from 'sonner';

interface ShippingTabProps {
  itemsToShip: InventoryItemShipping[];
  receivedItems: InventoryItemShipping[];
  onRefresh: () => void;
}

const CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Other'];

function ShipDialog({
  item,
  open,
  onOpenChange,
  onShipped,
}: {
  item: InventoryItemShipping;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onShipped: () => void;
}) {
  const [carrier, setCarrier] = useState('USPS');
  const [tracking, setTracking] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tracking.trim()) return;
    setLoading(true);
    try {
      await markItemShipped(item.id, carrier, tracking.trim());
      toast.success('Marked as shipped');
      setTracking('');
      onOpenChange(false);
      onShipped();
    } catch {
      toast.error('Failed to mark as shipped');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark as Shipped</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground mb-2 truncate">{item.title}</div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-white/50">Carrier</Label>
            <Select value={carrier} onValueChange={setCarrier}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CARRIERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-white/50">Tracking Number</Label>
            <Input
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="Enter tracking number"
              className="h-9 text-sm font-mono"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={loading || !tracking.trim()}>
              {loading ? 'Saving...' : 'Mark Shipped'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ShippingTab({ itemsToShip, receivedItems, onRefresh }: ShippingTabProps) {
  const [shipItem, setShipItem] = useState<InventoryItemShipping | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const pendingCount = itemsToShip.filter(i => !i.shipping_status || i.shipping_status === 'pending').length;
  const shippedCount = itemsToShip.filter(i => i.shipping_status === 'shipped').length;

  const handleQueueForShipping = async (item: InventoryItemShipping) => {
    setPendingId(item.id);
    try {
      await markItemShippingPending(item.id);
      toast.success('Queued for shipping');
      onRefresh();
    } catch {
      toast.error('Failed to update');
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border/40 bg-card/50 p-3 text-center">
          <div className="text-lg font-bold">{itemsToShip.length}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Total Sold</div>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-center">
          <div className="text-lg font-bold text-amber-400">{pendingCount}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">To Ship</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
          <div className="text-lg font-bold text-emerald-400">{shippedCount}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Shipped</div>
        </div>
      </div>

      <Tabs defaultValue="outgoing">
        <TabsList className="h-8 text-xs">
          <TabsTrigger value="outgoing" className="text-xs h-7 px-3">
            To Ship ({pendingCount})
          </TabsTrigger>
          <TabsTrigger value="incoming" className="text-xs h-7 px-3">
            Received ({receivedItems.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="outgoing" className="mt-4">
          {itemsToShip.length === 0 ? (
            <div className="rounded-xl border border-border/40 bg-card/50 flex flex-col items-center justify-center py-12">
              <Truck className="w-8 h-8 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">No items to ship</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Sold items will appear here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {itemsToShip.map((item) => (
                <div key={item.id} className="rounded-xl border border-border/40 bg-card/50 p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      item.shipping_status === 'shipped'
                        ? 'bg-emerald-500/10 border border-emerald-500/20'
                        : item.shipping_status === 'pending'
                        ? 'bg-amber-500/10 border border-amber-500/20'
                        : 'bg-secondary border border-border/40'
                    }`}>
                      {item.shipping_status === 'shipped'
                        ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                        : <Truck className="w-3.5 h-3.5 text-muted-foreground" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.title}</div>
                      {item.platform && (
                        <div className="text-xs text-muted-foreground mt-0.5">{item.platform}</div>
                      )}
                      <div className="flex items-center gap-3 mt-1.5">
                        {item.sell_price && (
                          <span className="text-xs text-emerald-400 flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />
                            {item.sell_price.toFixed(2)}
                          </span>
                        )}
                        {item.shipping_status === 'shipped' && item.tracking_number && (
                          <span className="text-xs text-muted-foreground font-mono">
                            {item.shipping_carrier} — {item.tracking_number}
                          </span>
                        )}
                        {item.shipping_status === 'shipped' && item.shipped_at && (
                          <span className="text-xs text-muted-foreground">
                            Shipped {new Date(item.shipped_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {item.shipping_status === 'shipped' ? (
                        <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
                          Shipped
                        </Badge>
                      ) : item.shipping_status === 'pending' ? (
                        <div className="flex flex-col gap-1.5 items-end">
                          <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">
                            Pending
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2"
                            onClick={() => setShipItem(item)}
                          >
                            <Truck className="w-3 h-3 mr-1" />
                            Add Tracking
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1.5 items-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={pendingId === item.id}
                            onClick={() => handleQueueForShipping(item)}
                          >
                            Queue
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setShipItem(item)}
                          >
                            <Truck className="w-3 h-3 mr-1" />
                            Ship
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="incoming" className="mt-4">
          {receivedItems.length === 0 ? (
            <div className="rounded-xl border border-border/40 bg-card/50 flex flex-col items-center justify-center py-12">
              <PackageCheck className="w-8 h-8 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">No items received yet</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Items scanned by this employee will appear here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {receivedItems.map((item) => (
                <div key={item.id} className="rounded-xl border border-border/40 bg-card/50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <Package className="w-3.5 h-3.5 text-sky-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.title}</div>
                      {item.platform && (
                        <div className="text-xs text-muted-foreground mt-0.5">{item.platform}</div>
                      )}
                      <div className="flex items-center gap-3 mt-1.5">
                        {item.purchase_price != null && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            Cost: ${item.purchase_price.toFixed(2)}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {new Date(item.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] shrink-0 ${
                        item.status === 'available'
                          ? 'border-emerald-500/30 text-emerald-400'
                          : item.status === 'sold'
                          ? 'border-sky-500/30 text-sky-400'
                          : 'border-border/60 text-muted-foreground'
                      }`}
                    >
                      {item.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {shipItem && (
        <ShipDialog
          item={shipItem}
          open={!!shipItem}
          onOpenChange={(v) => { if (!v) setShipItem(null); }}
          onShipped={onRefresh}
        />
      )}
    </div>
  );
}
