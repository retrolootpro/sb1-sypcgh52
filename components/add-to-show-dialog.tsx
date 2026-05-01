'use client';

import { useEffect, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import { SHOW_CATEGORIES } from '@/lib/constants';

type InventoryItem = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  purchase_price: number;
};

type AddToShowDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showId: string;
  onSuccess: () => void;
};

export function AddToShowDialog({ open, onOpenChange, showId, onSuccess }: AddToShowDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState(SHOW_CATEGORIES[0]);
  const [startPrice, setStartPrice] = useState('5.00');

  const loadAvailableItems = useCallback(async () => {
    try {
      const { data: existingItems } = await supabase
        .from('show_items')
        .select('item_id')
        .eq('show_list_id', showId);

      const existingItemIds = existingItems?.map((item) => item.item_id) || [];

      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, product_name, console, condition, purchase_price')
        .eq('user_id', user!.id)
        .not('id', 'in', `(${existingItemIds.join(',') || 'null'})`);

      if (error) throw error;
      setItems(data as InventoryItem[]);
    } catch (error) {
      console.error('Error loading items:', error);
    }
  }, [user, showId]);

  useEffect(() => {
    if (open && user) {
      loadAvailableItems();
    }
  }, [open, user, loadAvailableItems]);

  const handleToggleItem = (itemId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedItems.size === 0) {
      toast.error('Please select at least one item');
      return;
    }

    setLoading(true);

    try {
      const itemsToInsert = Array.from(selectedItems).map((itemId) => ({
        show_list_id: showId,
        item_id: itemId,
        start_price: parseFloat(startPrice),
        category: category,
      }));

      const { error } = await supabase
        .from('show_items')
        .insert(itemsToInsert);

      if (error) throw error;

      toast.success(`Added ${selectedItems.size} item(s) to show`);
      setSelectedItems(new Set());
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast.error(error.message || 'Failed to add items');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] bg-card border-white/10 max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Items to Show</DialogTitle>
          <DialogDescription>
            Select items from your inventory to add to this show
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={category}
                  onValueChange={(value) => setCategory(value as any)}
                >
                  <SelectTrigger className="bg-secondary/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHOW_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="start_price">Start Price</Label>
                <Input
                  id="start_price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={startPrice}
                  onChange={(e) => setStartPrice(e.target.value)}
                  required
                  className="bg-secondary/50"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Select Items ({selectedItems.size} selected)</Label>
              <div className="border border-white/10 rounded-lg max-h-[300px] overflow-y-auto">
                {items.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    No available items
                  </div>
                ) : (
                  <div className="p-2 space-y-2">
                    {items.map((item) => (
                      <label
                        key={item.id}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/30 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={selectedItems.has(item.id)}
                          onCheckedChange={() => handleToggleItem(item.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{item.product_name}</div>
                          <div className="text-sm text-muted-foreground">
                            {item.console} • {item.condition} • ${item.purchase_price.toFixed(2)}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || selectedItems.size === 0}>
              {loading ? 'Adding...' : `Add ${selectedItems.size} Item(s)`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
