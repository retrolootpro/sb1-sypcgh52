'use client';

import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Truck, PackageCheck, Plus, ShoppingBag, Package2, Tv, DollarSign, CheckCheck, Calendar, Trash2, ExternalLink, CircleAlert as AlertCircle, RefreshCw, User } from 'lucide-react';
import {
  getOutboundOrders,
  getInboundShipments,
  createInboundShipment,
  updateInboundShipment,
  markInboundReceived,
  deleteInboundShipment,
  markItemShipped,
  updateItemSoldVia,
  getPlatformOrders,
  markPlatformOrderShipped,
  syncEbayOrders,
  syncAmazonOrders,
  syncWhatnotOrders,
  type OutboundOrder,
  type InboundShipment,
  type PlatformOrder,
} from '@/lib/api-services';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';

const CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Other'];
const SOURCES = ['eBay Purchase', 'Amazon', 'Whatnot', 'Estate Sale', 'Thrift Store', 'Private Sale', 'Other'];

const PLATFORM_FILTERS = [
  { key: 'all', label: 'All Orders', icon: Truck, color: '' },
  { key: 'ebay', label: 'eBay', icon: ShoppingBag, color: 'text-orange-400' },
  { key: 'amazon', label: 'Amazon', icon: Package2, color: 'text-amber-400' },
  { key: 'whatnot', label: 'Whatnot', icon: Tv, color: 'text-cyan-400' },
];

function platformIcon(soldVia?: string) {
  if (soldVia === 'ebay') return <ShoppingBag className="w-3.5 h-3.5 text-orange-400" />;
  if (soldVia === 'amazon') return <Package2 className="w-3.5 h-3.5 text-amber-400" />;
  if (soldVia === 'whatnot') return <Tv className="w-3.5 h-3.5 text-cyan-400" />;
  return <Truck className="w-3.5 h-3.5 text-muted-foreground" />;
}

function platformBadgeClass(soldVia?: string) {
  if (soldVia === 'ebay') return 'border-orange-500/30 text-orange-400';
  if (soldVia === 'amazon') return 'border-amber-500/30 text-amber-400';
  if (soldVia === 'whatnot') return 'border-cyan-500/30 text-cyan-400';
  return 'border-border/60 text-muted-foreground';
}

function PlatformShipForm({ orderId, onShipped, onCancel }: {
  orderId: string;
  onShipped: () => void;
  onCancel: () => void;
}) {
  const [carrier, setCarrier] = useState('USPS');
  const [tracking, setTracking] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tracking.trim()) return;
    setLoading(true);
    try {
      await markPlatformOrderShipped(orderId, carrier, tracking.trim());
      toast.success('Order marked as shipped');
      onShipped();
    } catch {
      toast.error('Failed to mark as shipped');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
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
          autoFocus
        />
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={loading || !tracking.trim()}>
          {loading ? 'Saving...' : 'Mark Shipped'}
        </Button>
      </div>
    </form>
  );
}

function ShipOrderDialog({
  order, open, onOpenChange, onShipped,
}: {
  order: OutboundOrder;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onShipped: () => void;
}) {
  const [carrier, setCarrier] = useState('USPS');
  const [tracking, setTracking] = useState('');
  const [soldVia, setSoldVia] = useState(order.sold_via || '');
  const [orderId, setOrderId] = useState(order.marketplace_order_id || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tracking.trim()) return;
    setLoading(true);
    try {
      await markItemShipped(order.id, carrier, tracking.trim());
      if (soldVia && soldVia !== order.sold_via) {
        await updateItemSoldVia(order.id, soldVia, orderId.trim() || undefined);
      }
      toast.success('Order marked as shipped');
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
        <div className="text-xs text-muted-foreground mb-1 truncate font-medium">{order.title}</div>
        {order.platform && <div className="text-xs text-muted-foreground/60 mb-3">{order.platform}</div>}
        <form onSubmit={handleSubmit} className="space-y-3">
          {!order.sold_via && (
            <div className="space-y-1.5">
              <Label className="text-xs text-white/50">Platform Sold On</Label>
              <Select value={soldVia} onValueChange={setSoldVia}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select platform..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ebay">eBay</SelectItem>
                  <SelectItem value="amazon">Amazon</SelectItem>
                  <SelectItem value="whatnot">Whatnot</SelectItem>
                  <SelectItem value="show">Show / In-Person</SelectItem>
                  <SelectItem value="manual">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs text-white/50">Order ID (optional)</Label>
            <Input
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="Marketplace order #"
              className="h-9 text-sm font-mono"
            />
          </div>
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
              autoFocus
            />
          </div>
          <div className="flex gap-2 justify-end pt-1">
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

function AddInboundDialog({
  open, onOpenChange, onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
}) {
  const [form, setForm] = useState({
    title: '',
    source: 'Other',
    notes: '',
    tracking_number: '',
    carrier: 'USPS',
    expected_date: '',
    total_paid: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    try {
      await createInboundShipment({
        title: form.title.trim(),
        source: form.source,
        notes: form.notes.trim() || undefined,
        tracking_number: form.tracking_number.trim() || undefined,
        carrier: form.tracking_number.trim() ? form.carrier : undefined,
        expected_date: form.expected_date || undefined,
        total_paid: Number(form.total_paid) || 0,
        status: 'pending',
      });
      toast.success('Inbound shipment added');
      setForm({ title: '', source: 'Other', notes: '', tracking_number: '', carrier: 'USPS', expected_date: '', total_paid: '' });
      onOpenChange(false);
      onAdded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add shipment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Inbound Shipment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-white/50">Description</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="What are you receiving?"
              className="h-9 text-sm"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-white/50">Source</Label>
            <Select value={form.source} onValueChange={(v) => setForm(f => ({ ...f, source: v }))}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-white/50">Tracking (optional)</Label>
              <Input
                value={form.tracking_number}
                onChange={(e) => setForm(f => ({ ...f, tracking_number: e.target.value }))}
                placeholder="Tracking #"
                className="h-9 text-sm font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-white/50">Carrier</Label>
              <Select value={form.carrier} onValueChange={(v) => setForm(f => ({ ...f, carrier: v }))}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CARRIERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-white/50">Expected Date (optional)</Label>
            <Input
              type="date"
              value={form.expected_date}
              onChange={(e) => setForm(f => ({ ...f, expected_date: e.target.value }))}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-white/50">Total Paid (optional until received)</Label>
            <div className="relative">
              <DollarSign className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={form.total_paid}
                onChange={(e) => setForm(f => ({ ...f, total_paid: e.target.value.replace(/[^0-9.]/g, '') }))}
                inputMode="decimal"
                placeholder="0.00"
                className="h-9 pl-8 text-sm"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-white/50">Notes (optional)</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any notes about this shipment..."
              className="text-sm resize-none"
              rows={2}
            />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={loading || !form.title.trim()}>
              {loading ? 'Adding...' : 'Add Shipment'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ShippingPage() {
  const { user, loading: authLoading } = useAuth();
  const [outboundOrders, setOutboundOrders] = useState<OutboundOrder[]>([]);
  const [platformOrders, setPlatformOrders] = useState<PlatformOrder[]>([]);
  const [inboundShipments, setInboundShipments] = useState<InboundShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingAmazon, setSyncingAmazon] = useState(false);
  const [syncingWhatnot, setSyncingWhatnot] = useState(false);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [addInboundOpen, setAddInboundOpen] = useState(false);
  const [shipOrder, setShipOrder] = useState<OutboundOrder | null>(null);
  const [shipPlatformOrder, setShipPlatformOrder] = useState<PlatformOrder | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [receiveAmounts, setReceiveAmounts] = useState<Record<string, string>>({});

  const loadAll = useCallback(async () => {
    const [orders, shipments, pOrders] = await Promise.allSettled([
      getOutboundOrders(),
      getInboundShipments(),
      getPlatformOrders(),
    ]);

    if (orders.status === 'fulfilled') {
      setOutboundOrders(orders.value);
    } else {
      console.error('Failed to load outbound orders:', orders.reason);
    }

    if (shipments.status === 'fulfilled') {
      setInboundShipments(shipments.value);
      const seededAmounts = shipments.value.reduce<Record<string, string>>((acc, shipment) => {
        const paid = Number(shipment.total_paid) || 0;
        if (shipment.status === 'pending' && paid > 0) acc[shipment.id] = paid.toFixed(2);
        return acc;
      }, {});
      setReceiveAmounts((prev) => ({ ...seededAmounts, ...prev }));
    } else {
      console.error('Failed to load inbound shipments:', shipments.reason);
      toast.error('Could not load inbound shipments', {
        description: shipments.reason instanceof Error ? shipments.reason.message : 'Check the shipping data connection.',
      });
    }

    if (pOrders.status === 'fulfilled') {
      setPlatformOrders(pOrders.value);
    } else {
      console.error('Failed to load marketplace orders:', pOrders.reason);
    }
    setLoading(false);
  }, []);

  const handleSyncEbay = async () => {
    setSyncing(true);
    try {
      const result = await syncEbayOrders();
      if (result.total === 0) {
        toast.success('No pending eBay orders found');
      } else {
        toast.success(`Synced ${result.imported} eBay order${result.imported !== 1 ? 's' : ''}`);
      }
      loadAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncAmazon = async () => {
    setSyncingAmazon(true);
    try {
      const result = await syncAmazonOrders();
      if (result.total === 0) {
        toast.success('No unshipped Amazon orders found');
      } else {
        toast.success(`Synced ${result.imported} Amazon order${result.imported !== 1 ? 's' : ''}`);
      }
      loadAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      toast.error(msg);
    } finally {
      setSyncingAmazon(false);
    }
  };

  const handleSyncWhatnot = async () => {
    setSyncingWhatnot(true);
    try {
      const result = await syncWhatnotOrders();
      if (result.imported === 0) {
        toast.success('No new Whatnot orders found');
      } else {
        toast.success(`Synced ${result.imported} Whatnot order${result.imported !== 1 ? 's' : ''}`);
      }
      loadAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      toast.error(msg);
    } finally {
      setSyncingWhatnot(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      loadAll();
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [loadAll, authLoading, user]);

  const handleMarkReceived = async (id: string) => {
    const totalPaid = Number(receiveAmounts[id]);
    if (!Number.isFinite(totalPaid) || totalPaid <= 0) {
      toast.error('Enter the total paid for this shipment before receiving it');
      return;
    }
    setProcessingId(id);
    try {
      await markInboundReceived(id, totalPaid);
      toast.success('Shipment received and lot created');
      loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDeleteInbound = async (id: string) => {
    setProcessingId(id);
    try {
      await deleteInboundShipment(id);
      toast.success('Removed');
      loadAll();
    } catch {
      toast.error('Failed to remove');
    } finally {
      setProcessingId(null);
    }
  };

  const filteredOrders = platformFilter === 'all'
    ? outboundOrders
    : outboundOrders.filter(o => o.sold_via === platformFilter);

  const filteredPlatformOrders = platformFilter === 'all'
    ? platformOrders
    : platformOrders.filter(o => o.platform === platformFilter);

  const toShip = [
    ...outboundOrders.filter(o => !o.shipping_status || o.shipping_status === 'pending'),
    ...platformOrders.filter(o => o.shipping_status === 'pending'),
  ];
  const shipped = [
    ...outboundOrders.filter(o => o.shipping_status === 'shipped'),
    ...platformOrders.filter(o => o.shipping_status === 'shipped'),
  ];
  const pendingReceive = inboundShipments.filter(s => s.status === 'pending');
  const received = inboundShipments.filter(s => s.status === 'received');

  const unassigned = outboundOrders.filter(o => !o.sold_via).length;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-7 w-7 border-2 border-primary border-t-transparent" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-8 lg:p-10 space-y-7 max-w-5xl">
        <div>
          <div className="label-caps mb-1">Operations</div>
          <h1 className="heading-lg text-[22px]">Shipping Hub</h1>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="text-lg font-bold text-amber-400">{toShip.length}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">To Ship</div>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="text-lg font-bold text-emerald-400">{shipped.length}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Shipped</div>
          </div>
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
            <div className="text-lg font-bold text-sky-400">{pendingReceive.length}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">To Receive</div>
          </div>
          <div className="rounded-xl border border-border/40 bg-card/50 p-4">
            <div className="text-lg font-bold">{received.length}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Received</div>
          </div>
        </div>

        <Tabs defaultValue="outbound">
          <TabsList className="h-9 text-xs mb-1">
            <TabsTrigger value="outbound" className="text-xs gap-1.5">
              <Truck className="w-3.5 h-3.5" />
              Outbound
              {toShip.length > 0 && (
                <span className="ml-1 w-4 h-4 rounded-full bg-amber-500 text-[9px] font-bold text-black flex items-center justify-center">
                  {toShip.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="inbound" className="text-xs gap-1.5">
              <PackageCheck className="w-3.5 h-3.5" />
              Inbound
              {pendingReceive.length > 0 && (
                <span className="ml-1 w-4 h-4 rounded-full bg-sky-500 text-[9px] font-bold text-white flex items-center justify-center">
                  {pendingReceive.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="outbound" className="mt-4 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-muted-foreground">
                Sold items ready to fulfill
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300"
                  onClick={handleSyncWhatnot}
                  disabled={syncingWhatnot}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingWhatnot ? 'animate-spin' : ''}`} />
                  {syncingWhatnot ? 'Syncing...' : 'Sync Whatnot'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                  onClick={handleSyncAmazon}
                  disabled={syncingAmazon}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingAmazon ? 'animate-spin' : ''}`} />
                  {syncingAmazon ? 'Syncing...' : 'Sync Amazon'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5 border-orange-500/30 text-orange-400 hover:bg-orange-500/10 hover:text-orange-300"
                  onClick={handleSyncEbay}
                  disabled={syncing}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Syncing...' : 'Sync eBay'}
                </Button>
              </div>
            </div>

            {unassigned > 0 && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-300/80">
                  <span className="font-semibold text-amber-300">{unassigned} order{unassigned !== 1 ? 's' : ''}</span> not assigned to a platform. Use "Mark Shipped" to assign them to eBay, Amazon, or Whatnot.
                </div>
              </div>
            )}

            <div className="flex gap-1.5 flex-wrap">
              {PLATFORM_FILTERS.map(({ key, label, icon: Icon, color }) => {
                const invCount = key === 'all' ? outboundOrders.length : outboundOrders.filter(o => o.sold_via === key).length;
                const platCount = key === 'all' ? platformOrders.length : platformOrders.filter(o => o.platform === key).length;
                const count = invCount + platCount;
                return (
                  <button
                    key={key}
                    onClick={() => setPlatformFilter(key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      platformFilter === key
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border/40 bg-card/50 text-muted-foreground hover:text-white/70 hover:border-border/60'
                    }`}
                  >
                    <Icon className={`w-3 h-3 ${platformFilter === key ? 'text-primary' : color}`} />
                    {label}
                    <span className={`ml-1 text-[10px] ${platformFilter === key ? 'text-primary/70' : 'text-muted-foreground/60'}`}>
                      ({count})
                    </span>
                  </button>
                );
              })}
            </div>

            {filteredOrders.length === 0 && filteredPlatformOrders.length === 0 ? (
              <div className="rounded-xl border border-border/40 bg-card/50 flex flex-col items-center justify-center py-14">
                <Truck className="w-8 h-8 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">
                  {platformFilter === 'all' ? 'No sold orders yet' : `No ${platformFilter} orders`}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">
                  Sold inventory items or synced eBay orders will appear here
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredOrders.map((order) => (
                  <div key={order.id} className="rounded-xl border border-border/40 bg-card/50 p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        order.shipping_status === 'shipped'
                          ? 'bg-emerald-500/10 border border-emerald-500/20'
                          : 'bg-secondary border border-border/40'
                      }`}>
                        {order.shipping_status === 'shipped'
                          ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                          : platformIcon(order.sold_via)
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-sm font-medium truncate">{order.title}</div>
                          {order.sold_via && (
                            <Badge variant="outline" className={`text-[10px] ${platformBadgeClass(order.sold_via)}`}>
                              {order.sold_via}
                            </Badge>
                          )}
                        </div>
                        {order.platform && (
                          <div className="text-xs text-muted-foreground mt-0.5">{order.platform}</div>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          {order.sell_price != null && (
                            <span className="text-xs text-emerald-400 flex items-center gap-1">
                              <DollarSign className="w-3 h-3" />
                              {order.sell_price.toFixed(2)}
                            </span>
                          )}
                          {order.marketplace_order_id && (
                            <span className="text-xs text-muted-foreground font-mono">
                              #{order.marketplace_order_id}
                            </span>
                          )}
                          {order.shipping_status === 'shipped' && order.tracking_number && (
                            <span className="text-xs text-muted-foreground font-mono">
                              {order.shipping_carrier} — {order.tracking_number}
                            </span>
                          )}
                          {order.shipping_status === 'shipped' && order.shipped_at && (
                            <span className="text-xs text-muted-foreground">
                              Shipped {new Date(order.shipped_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {order.shipping_status === 'shipped' ? (
                          <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
                            Shipped
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => setShipOrder(order)}
                          >
                            <Truck className="w-3 h-3 mr-1.5" />
                            Ship
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {filteredPlatformOrders.length > 0 && (
                  <>
                    {filteredOrders.length > 0 && (
                      <div className="flex items-center gap-2 pt-1">
                        <div className="h-px flex-1 bg-border/30" />
                        <span className="text-[10px] text-muted-foreground/50 font-medium">MARKETPLACE ORDERS</span>
                        <div className="h-px flex-1 bg-border/30" />
                      </div>
                    )}
                    {filteredPlatformOrders.map((order) => {
                      const isEbay = order.platform === 'ebay';
                      const isAmazon = order.platform === 'amazon';
                      const isWhatnot = order.platform === 'whatnot';
                      const accentColor = isEbay ? 'orange' : isAmazon ? 'amber' : isWhatnot ? 'cyan' : 'orange';
                      const PlatformIcon = isEbay ? ShoppingBag : isAmazon ? Package2 : Tv;
                      const badgeClass = isEbay ? 'border-orange-500/30 text-orange-400'
                        : isAmazon ? 'border-amber-500/30 text-amber-400'
                        : 'border-cyan-500/30 text-cyan-400';
                      const platformLabel = isEbay ? 'eBay' : isAmazon ? 'Amazon' : 'Whatnot';
                      const iconClass = isEbay ? 'text-orange-400' : isAmazon ? 'text-amber-400' : 'text-cyan-400';
                      const bgBorderClass = isEbay
                        ? 'border-orange-500/15 bg-orange-500/5'
                        : isAmazon ? 'border-amber-500/15 bg-amber-500/5'
                        : 'border-cyan-500/15 bg-cyan-500/5';
                      const iconBgClass = isEbay
                        ? 'bg-orange-500/10 border-orange-500/20'
                        : isAmazon ? 'bg-amber-500/10 border-amber-500/20'
                        : 'bg-cyan-500/10 border-cyan-500/20';
                      const shipBtnClass = isEbay
                        ? 'bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 border-orange-500/30'
                        : isAmazon ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border-amber-500/30'
                        : 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-400 border-cyan-500/30';
                      void accentColor;
                      return (
                        <div key={order.id} className={`rounded-xl border p-4 ${bgBorderClass}`}>
                          <div className="flex items-start gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${
                              order.shipping_status === 'shipped'
                                ? 'bg-emerald-500/10 border-emerald-500/20'
                                : iconBgClass
                            }`}>
                              {order.shipping_status === 'shipped'
                                ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                                : <PlatformIcon className={`w-3.5 h-3.5 ${iconClass}`} />
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="text-sm font-medium truncate">{order.item_title}</div>
                                <Badge variant="outline" className={`text-[10px] ${badgeClass}`}>{platformLabel}</Badge>
                              </div>
                              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                {order.buyer_username && (
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <User className="w-3 h-3" />
                                    {order.buyer_username}
                                  </span>
                                )}
                                {order.sale_price != null && (
                                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                                    <DollarSign className="w-3 h-3" />
                                    {order.sale_price.toFixed(2)}
                                  </span>
                                )}
                                {!order.platform_order_id.startsWith('wn-manual-') && (
                                  <span className="text-xs text-muted-foreground font-mono">
                                    #{order.platform_order_id.slice(-8)}
                                  </span>
                                )}
                                {order.shipping_status === 'shipped' && order.tracking_number && (
                                  <span className="text-xs text-muted-foreground font-mono">
                                    {order.shipping_carrier} — {order.tracking_number}
                                  </span>
                                )}
                                {order.shipping_address?.city && (
                                  <span className="text-xs text-muted-foreground">
                                    {order.shipping_address.city}{order.shipping_address.state ? `, ${order.shipping_address.state}` : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="shrink-0">
                              {order.shipping_status === 'shipped' ? (
                                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">Shipped</Badge>
                              ) : (
                                <Button size="sm" className={`h-8 text-xs border ${shipBtnClass}`} variant="outline"
                                  onClick={() => setShipPlatformOrder(order)}>
                                  <Truck className="w-3 h-3 mr-1.5" />
                                  Ship
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="inbound" className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Expected Shipments</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Every intake starts here. Receiving a shipment creates the lot used for scanning and cost allocation.
                </p>
              </div>
              <Button size="sm" className="h-8 text-xs" onClick={() => setAddInboundOpen(true)}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Add Shipment
              </Button>
            </div>

            {inboundShipments.length === 0 ? (
              <div className="rounded-xl border border-border/40 bg-card/50 flex flex-col items-center justify-center py-14">
                <PackageCheck className="w-8 h-8 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">No inbound shipments</p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">Add packages you're expecting to receive</p>
                <Button size="sm" variant="outline" className="mt-4" onClick={() => setAddInboundOpen(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Add Shipment
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingReceive.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-sky-400 mb-2 flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                      Pending ({pendingReceive.length})
                    </div>
                    <div className="space-y-2">
                      {pendingReceive.map((shipment) => (
                        <div key={shipment.id} className="rounded-xl border border-sky-500/15 bg-sky-500/5 p-4">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0 mt-0.5">
                              <PackageCheck className="w-3.5 h-3.5 text-sky-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{shipment.title}</div>
                              <div className="flex items-center gap-3 mt-1 flex-wrap">
                                <span className="text-xs text-muted-foreground">{shipment.source}</span>
                                {Number(shipment.total_paid) > 0 && (
                                  <span className="text-xs text-sky-300">
                                    Paid ${Number(shipment.total_paid).toFixed(2)}
                                  </span>
                                )}
                                {shipment.expected_date && (
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    Expected {new Date(shipment.expected_date).toLocaleDateString()}
                                  </span>
                                )}
                                {shipment.tracking_number && (
                                  <span className="text-xs text-muted-foreground font-mono">
                                    {shipment.carrier} — {shipment.tracking_number}
                                  </span>
                                )}
                              </div>
                              {shipment.notes && (
                                <div className="text-xs text-muted-foreground/60 mt-1 italic">{shipment.notes}</div>
                              )}
                              <div className="mt-3 max-w-xs">
                                <Label className="text-[10px] text-sky-200/70 uppercase tracking-wider">Total paid for lot</Label>
                                <div className="relative mt-1">
                                  <DollarSign className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                  <Input
                                    value={receiveAmounts[shipment.id] ?? (Number(shipment.total_paid) > 0 ? Number(shipment.total_paid).toFixed(2) : '')}
                                    onChange={(event) => setReceiveAmounts((prev) => ({
                                      ...prev,
                                      [shipment.id]: event.target.value.replace(/[^0-9.]/g, ''),
                                    }))}
                                    inputMode="decimal"
                                    placeholder="0.00"
                                    className="h-8 pl-8 text-xs bg-card/60 border-sky-500/20"
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                disabled={processingId === shipment.id || !(Number(receiveAmounts[shipment.id]) > 0)}
                                onClick={() => handleMarkReceived(shipment.id)}
                              >
                                <CheckCheck className="w-3 h-3 mr-1" />
                                Received
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                disabled={processingId === shipment.id}
                                onClick={() => handleDeleteInbound(shipment.id)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {received.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-emerald-400 mb-2 flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Received ({received.length})
                    </div>
                    <div className="space-y-2">
                      {received.map((shipment) => (
                        <div key={shipment.id} className="rounded-xl border border-border/40 bg-card/50 p-4 opacity-70">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                              <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{shipment.title}</div>
                              <div className="flex items-center gap-3 mt-1 flex-wrap">
                                <span className="text-xs text-muted-foreground">{shipment.source}</span>
                                {Number(shipment.total_paid) > 0 && (
                                  <span className="text-xs text-emerald-400">
                                    Lot paid ${Number(shipment.total_paid).toFixed(2)}
                                  </span>
                                )}
                                {shipment.lot_id && (
                                  <span className="text-xs text-muted-foreground font-mono">
                                    Lot {shipment.lot_id.slice(0, 8)}
                                  </span>
                                )}
                                {shipment.received_at && (
                                  <span className="text-xs text-muted-foreground">
                                    Received {new Date(shipment.received_at).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
                                Received
                              </Badge>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                disabled={processingId === shipment.id}
                                onClick={() => handleDeleteInbound(shipment.id)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {shipOrder && (
        <ShipOrderDialog
          order={shipOrder}
          open={!!shipOrder}
          onOpenChange={(v) => { if (!v) setShipOrder(null); }}
          onShipped={() => { setShipOrder(null); loadAll(); }}
        />
      )}

      {shipPlatformOrder && (
        <Dialog open={!!shipPlatformOrder} onOpenChange={(v) => { if (!v) setShipPlatformOrder(null); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Mark as Shipped</DialogTitle>
            </DialogHeader>
            <div className="text-xs text-muted-foreground mb-1 truncate font-medium">{shipPlatformOrder.item_title}</div>
            {shipPlatformOrder.buyer_username && (
              <div className="text-xs text-muted-foreground/60 mb-3">Buyer: {shipPlatformOrder.buyer_username}</div>
            )}
            <PlatformShipForm
              orderId={shipPlatformOrder.id}
              onShipped={() => { setShipPlatformOrder(null); loadAll(); }}
              onCancel={() => setShipPlatformOrder(null)}
            />
          </DialogContent>
        </Dialog>
      )}

      <AddInboundDialog
        open={addInboundOpen}
        onOpenChange={setAddInboundOpen}
        onAdded={loadAll}
      />

    </DashboardLayout>
  );
}
