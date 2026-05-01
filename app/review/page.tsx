'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { CircleCheck as CheckCircle2, Circle as XCircle, Search, Package, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { CONSOLES, CONDITIONS } from '@/lib/constants';
import { normalizeTitle } from '@/lib/barcode-lookup';

type ReviewItem = {
  id: string;
  barcode: string;
  product_name: string;
  item_type: string;
  brand: string;
  image_url: string;
  confidence_score: number;
  console: string;
  condition: string;
  purchase_price: number;
  quantity: number;
  notes: string;
  pricing_status: string;
  created_at: string;
};

export default function ReviewQueuePage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null);
  const [formData, setFormData] = useState({
    product_name: '',
    console: 'Unknown',
    condition: 'Loose' as string,
    purchase_price: '0',
    quantity: '1',
    notes: '',
  });

  const loadReviewQueue = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, barcode, product_name, item_type, brand, image_url, confidence_score, console, condition, purchase_price, quantity, notes, pricing_status, created_at')
        .eq('user_id', user.id)
        .eq('needs_review', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setItems((data ?? []) as ReviewItem[]);
    } catch (error) {
      console.error('Error loading review queue:', error);
      toast.error('Failed to load review queue');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadReviewQueue();
    }
  }, [user, loadReviewQueue]);

  const selectItem = (item: ReviewItem) => {
    setSelectedItem(item);
    setFormData({
      product_name: item.product_name,
      console: item.console || 'Unknown',
      condition: item.condition || 'Loose',
      purchase_price: String(item.purchase_price ?? 0),
      quantity: String(item.quantity ?? 1),
      notes: item.notes || '',
    });
  };

  const handleApprove = async () => {
    if (!selectedItem || !user) return;

    try {
      const { error } = await supabase
        .from('inventory_items')
        .update({
          product_name: formData.product_name,
          console: formData.console,
          condition: formData.condition,
          purchase_price: parseFloat(formData.purchase_price),
          quantity: parseInt(formData.quantity),
          notes: formData.notes,
          normalized_title: normalizeTitle(formData.product_name),
          needs_review: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedItem.id)
        .eq('user_id', user.id);

      if (error) throw error;

      toast.success(`${formData.product_name} approved`);

      const remaining = items.filter(i => i.id !== selectedItem.id);
      setItems(remaining);
      setSelectedItem(remaining[0] ?? null);
      if (remaining[0]) selectItem(remaining[0]);
    } catch (error: any) {
      toast.error(error.message || 'Failed to approve item');
    }
  };

  const handleReject = async () => {
    if (!selectedItem || !user) return;

    try {
      const { error } = await supabase
        .from('inventory_items')
        .delete()
        .eq('id', selectedItem.id)
        .eq('user_id', user.id);

      if (error) throw error;

      toast.success('Item removed');
      const remaining = items.filter(i => i.id !== selectedItem.id);
      setItems(remaining);
      setSelectedItem(remaining[0] ?? null);
      if (remaining[0]) selectItem(remaining[0]);
    } catch (error: any) {
      toast.error(error.message || 'Failed to remove item');
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-7 w-7 border-2 border-primary border-t-transparent"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-8 lg:p-10 space-y-8 max-w-6xl">
        <div>
          <div className="label-caps mb-1">Catalog</div>
          <h1 className="heading-lg text-[22px]">Review Queue</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Review and approve items that require manual verification
          </p>
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-border/40 bg-card">
            <div className="flex flex-col items-center justify-center py-16">
              <Package className="w-10 h-10 mb-3 text-muted-foreground/20" />
              <h3 className="text-sm font-medium mb-1">No items to review</h3>
              <p className="text-xs text-muted-foreground text-center max-w-md">
                Items flagged during scanning will appear here for manual review
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
              <div className="px-6 py-4 border-b border-border/40">
                <h3 className="font-semibold text-[15px] tracking-tight">Pending Items ({items.length})</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Select an item to review</p>
              </div>
              <div className="p-2 max-h-[600px] overflow-y-auto">
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => selectItem(item)}
                      className={`w-full text-left p-3 rounded-lg transition-all ${
                        selectedItem?.id === item.id
                          ? 'bg-primary/10 ring-1 ring-primary/30'
                          : 'hover:bg-secondary/40'
                      }`}
                    >
                      <div className="font-medium text-sm truncate">{item.product_name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {item.barcode}{item.brand ? ` — ${item.brand}` : ''}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        {item.confidence_score > 0 && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 h-4 ${
                              item.confidence_score >= 60
                                ? 'border-amber-500/30 text-amber-400'
                                : 'border-red-500/30 text-red-400'
                            }`}
                          >
                            {item.confidence_score}% confidence
                          </Badge>
                        )}
                        {item.item_type && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-border/60">
                            {item.item_type}
                          </Badge>
                        )}
                        {item.pricing_status && item.pricing_status !== 'success' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-500/30 text-amber-400">
                            {item.pricing_status}
                          </Badge>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
              <div className="px-6 py-4 border-b border-border/40">
                <h3 className="font-semibold text-[15px] tracking-tight">Review Details</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedItem ? 'Edit and approve or reject this item' : 'Select an item to review'}
                </p>
              </div>
              <div className="p-5">
                {!selectedItem ? (
                  <div className="text-center py-12">
                    <Search className="w-10 h-10 mx-auto mb-2 text-muted-foreground/20" />
                    <p className="text-sm text-muted-foreground">Select an item from the list</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {selectedItem.image_url && (
                      <div className="relative aspect-square w-full max-w-xs mx-auto rounded-lg overflow-hidden bg-secondary/20 border border-border/40">
                        <img
                          src={selectedItem.image_url}
                          alt={selectedItem.product_name}
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                        {!selectedItem.image_url && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <ImageIcon className="w-12 h-12 text-muted-foreground/20" />
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs">Product Name</Label>
                        <Input
                          value={formData.product_name}
                          onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
                          className="bg-secondary/40 border-border/60 h-9 text-sm mt-1"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Console</Label>
                          <Select
                            value={formData.console}
                            onValueChange={(value) => setFormData({ ...formData, console: value })}
                          >
                            <SelectTrigger className="bg-secondary/40 border-border/60 h-9 text-sm mt-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CONSOLES.map((c) => (
                                <SelectItem key={c} value={c}>{c}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs">Condition</Label>
                          <Select
                            value={formData.condition}
                            onValueChange={(value) => setFormData({ ...formData, condition: value })}
                          >
                            <SelectTrigger className="bg-secondary/40 border-border/60 h-9 text-sm mt-1">
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

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Purchase Price</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={formData.purchase_price}
                            onChange={(e) => setFormData({ ...formData, purchase_price: e.target.value })}
                            className="bg-secondary/40 border-border/60 h-9 text-sm mt-1"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Quantity</Label>
                          <Input
                            type="number"
                            value={formData.quantity}
                            onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                            className="bg-secondary/40 border-border/60 h-9 text-sm mt-1"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <Button onClick={handleApprove} className="h-10">
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Approve
                      </Button>
                      <Button onClick={handleReject} variant="outline" className="h-10 text-destructive hover:text-destructive">
                        <XCircle className="w-4 h-4 mr-2" />
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
