'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import { CONSOLES, CONDITIONS, REGIONS } from '@/lib/constants';
import { getCanonicalPricing } from '@/lib/pricing-service';
import { calculateDealScore, getMarketValueByCondition } from '@/lib/deal-score';

type AddItemDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  defaultCollectionId?: string | null;
  defaultLotId?: string | null;
};

type Lot = { id: string; name: string };

export function AddItemDialog({ open, onOpenChange, onSuccess, defaultCollectionId, defaultLotId }: AddItemDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [lots, setLots] = useState<Lot[]>([]);
  const [formData, setFormData] = useState({
    product_name: '',
    console: 'Nintendo Switch',
    condition: 'CIB' as 'Loose' | 'CIB' | 'New',
    region: 'US',
    purchase_price: '',
    quantity: '1',
    notes: '',
    barcode: '',
    lot_id: defaultLotId ?? '',
  });

  useEffect(() => {
    if (open && user) {
      supabase
        .from('lots')
        .select('id, name')
        .eq('user_id', user.id)
        .order('received_at', { ascending: false })
        .then(({ data }) => setLots(data || []));
    }
  }, [open, user]);

  useEffect(() => {
    if (defaultLotId !== undefined) {
      setFormData(prev => ({ ...prev, lot_id: defaultLotId ?? '' }));
    }
  }, [defaultLotId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.product_name?.trim()) {
      toast.error('Product name is required');
      return;
    }

    const price = parseFloat(formData.purchase_price);
    if (isNaN(price) || price < 0) {
      toast.error('Please enter a valid purchase price');
      return;
    }

    const qty = parseInt(formData.quantity);
    if (isNaN(qty) || qty < 1) {
      toast.error('Quantity must be at least 1');
      return;
    }

    setLoading(true);

    try {
      const { data: inventoryItem, error } = await supabase
        .from('inventory_items')
        .insert({
          user_id: user!.id,
          product_name: formData.product_name.trim(),
          console: formData.console,
          condition: formData.condition,
          region: formData.region,
          purchase_price: price,
          quantity: qty,
          notes: formData.notes?.trim() || null,
          barcode: formData.barcode?.trim() || null,
          collection_id: defaultCollectionId || null,
          lot_id: formData.lot_id || null,
        })
        .select()
        .single();

      if (error) throw new Error(error.message || 'Failed to add item');
      if (!inventoryItem) throw new Error('Item created but no data returned');

      try {
        const pricingData = await getCanonicalPricing(formData.product_name.trim(), formData.console, {
          upc: formData.barcode?.trim() || null,
          forceRefresh: true,
        });

        if (pricingData.status !== 'api_error') {
          const loosePrice = pricingData.prices.loose.value || 0;
          const cibPrice = pricingData.prices.cib.value || 0;
          const newPrice = pricingData.prices.new.value || 0;
          const gradedPrice = pricingData.prices.graded.value || 0;
          const marketValue = getMarketValueByCondition(formData.condition, loosePrice, cibPrice, newPrice, gradedPrice);
          const estimatedProfit = marketValue > 0 ? marketValue - price : 0;
          const estimatedMarginPercent = marketValue > 0 && price > 0 ? (estimatedProfit / price) * 100 : 0;
          const dealScore = marketValue > 0 ? calculateDealScore(price, marketValue) : null;

          await supabase
            .from('inventory_items')
            .update({
              price_loose: loosePrice,
              price_cib: cibPrice,
              price_new: newPrice,
              price_graded: gradedPrice,
              selected_market_value: marketValue,
              estimated_profit: estimatedProfit,
              estimated_margin_percent: estimatedMarginPercent,
              deal_score: dealScore?.score ?? 0,
              deal_score_label: dealScore?.label ?? '',
              pricing_status: marketValue > 0 ? 'found' : 'missing',
              pricing_last_checked_at: new Date().toISOString(),
              pricing_source: pricingData.source || 'pricecharting',
              pricing_confidence: pricingData.pcMatch ? 90 : null,
              pricing_matched_title: pricingData.pcMatch?.productName ?? null,
              pricing_matched_platform: pricingData.pcMatch?.platform ?? null,
              pc_source_product_id: pricingData.pcMatch?.productId ?? null,
              pricing_diagnostics: pricingData.diagnostics,
            })
            .eq('id', inventoryItem.id);

          await supabase.from('pricing_data').insert({
            item_id: inventoryItem.id,
            loose_price: loosePrice,
            cib_price: cibPrice,
            new_price: newPrice,
            fetched_at: new Date().toISOString(),
          });
        }
      } catch { /* pricing is optional */ }

      toast.success('Item added successfully!');
      setFormData({
        product_name: '',
        console: 'Nintendo Switch',
        condition: 'CIB',
        region: 'US',
        purchase_price: '',
        quantity: '1',
        notes: '',
        barcode: '',
        lot_id: defaultLotId ?? '',
      });
      onOpenChange(false);
      onSuccess();
    } catch (error: unknown) {
      toast.error((error as Error).message || 'Failed to add item. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-card border-white/10">
        <DialogHeader>
          <DialogTitle>Add Inventory Item</DialogTitle>
          <DialogDescription>
            Add a new item to your inventory. Pricing data will be fetched automatically.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="product_name">Product Name</Label>
              <Input
                id="product_name"
                placeholder="e.g., The Legend of Zelda: Breath of the Wild"
                value={formData.product_name}
                onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
                required
                className="bg-secondary/50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="console">Console</Label>
                <Select
                  value={formData.console}
                  onValueChange={(value) => setFormData({ ...formData, console: value })}
                >
                  <SelectTrigger className="bg-secondary/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONSOLES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="condition">Condition</Label>
                <Select
                  value={formData.condition}
                  onValueChange={(value) => setFormData({ ...formData, condition: value as 'Loose' | 'CIB' | 'New' })}
                >
                  <SelectTrigger className="bg-secondary/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITIONS.map((cond) => (
                      <SelectItem key={cond} value={cond}>{cond}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="region">Region / TV Standard</Label>
              <Select
                value={formData.region}
                onValueChange={(value) => setFormData({ ...formData, region: value })}
              >
                <SelectTrigger className="bg-secondary/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REGIONS.map((region) => (
                    <SelectItem key={region.value} value={region.value}>{region.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="purchase_price">Purchase Price</Label>
                <Input
                  id="purchase_price"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={formData.purchase_price}
                  onChange={(e) => setFormData({ ...formData, purchase_price: e.target.value })}
                  required
                  className="bg-secondary/50"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  required
                  className="bg-secondary/50"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lot">Assign to Lot <span className="text-muted-foreground font-normal">(Optional)</span></Label>
              <Select
                value={formData.lot_id || '__none__'}
                onValueChange={(v) => setFormData({ ...formData, lot_id: v === '__none__' ? '' : v })}
              >
                <SelectTrigger className="bg-secondary/50">
                  <SelectValue placeholder="No lot — individual item" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No lot — individual item</SelectItem>
                  {lots.map(lot => (
                    <SelectItem key={lot.id} value={lot.id}>{lot.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="barcode">Barcode / UPC <span className="text-muted-foreground font-normal">(Optional)</span></Label>
              <Input
                id="barcode"
                placeholder="Enter barcode"
                value={formData.barcode}
                onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                className="bg-secondary/50"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes <span className="text-muted-foreground font-normal">(Optional)</span></Label>
              <Textarea
                id="notes"
                placeholder="Add any notes about this item..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="bg-secondary/50 min-h-[80px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Adding...' : 'Add Item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
