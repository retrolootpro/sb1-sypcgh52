'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { ArrowLeft, Plus, Trash2, DollarSign } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { AddToShowDialog } from '@/components/add-to-show-dialog';
import { toast } from 'sonner';

type ShowItem = {
  id: string;
  start_price: number;
  category: string;
  item_id: string;
  inventory_items: {
    product_name: string;
    console: string;
    condition: string;
    purchase_price: number;
  };
};

type ShowList = {
  id: string;
  name: string;
  show_date: string | null;
  created_at: string;
};

export default function ShowDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [show, setShow] = useState<ShowList | null>(null);
  const [items, setItems] = useState<ShowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const loadShowData = useCallback(async () => {
    try {
      const [showRes, itemsRes] = await Promise.all([
        supabase
          .from('show_lists')
          .select('*')
          .eq('id', params.id as string)
          .eq('user_id', user!.id)
          .single(),
        supabase
          .from('show_items')
          .select(`
            *,
            inventory_items (
              product_name,
              console,
              condition,
              purchase_price
            )
          `)
          .eq('show_list_id', params.id as string),
      ]);

      if (showRes.error) throw showRes.error;
      if (itemsRes.error) throw itemsRes.error;

      setShow(showRes.data);
      setItems(itemsRes.data as ShowItem[]);
    } catch (error) {
      console.error('Error loading show data:', error);
      router.push('/shows');
    } finally {
      setLoading(false);
    }
  }, [user, params.id, router]);

  useEffect(() => {
    if (user && params.id) {
      loadShowData();
    }
  }, [user, params.id, loadShowData]);

  const handleRemoveItem = async (itemId: string) => {
    try {
      const { error } = await supabase
        .from('show_items')
        .delete()
        .eq('id', itemId);

      if (error) throw error;

      toast.success('Item removed from show');
      loadShowData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to remove item');
    }
  };

  const getItemsByCategory = (category: string) => {
    return items.filter((item) => item.category === category);
  };

  const getTotalRevenue = () => {
    return items.reduce((sum, item) => sum + item.start_price, 0);
  };

  const categories = ['$5 Start', '$10 Start', 'High Value', 'Bundles'];

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-7 w-7 border-2 border-primary border-t-transparent"></div>
        </div>
      </DashboardLayout>
    );
  }

  if (!show) {
    return null;
  }

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
        <Link href="/shows">
          <Button variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back
          </Button>
        </Link>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{show.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {show.show_date
                ? `Scheduled for ${format(new Date(show.show_date), 'MMMM d, yyyy')}`
                : 'No date set'}
            </p>
          </div>
          <Button size="sm" className="h-9" onClick={() => setShowAddDialog(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Items
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card/60 p-5">
            <div className="text-xs text-muted-foreground mb-1">Total Items</div>
            <div className="text-2xl font-bold">{items.length}</div>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/60 p-5">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-muted-foreground">Est. Revenue</div>
              <DollarSign className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="text-2xl font-bold text-primary">${getTotalRevenue().toFixed(2)}</div>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/60 p-5">
            <div className="text-xs text-muted-foreground mb-1">Avg Start Price</div>
            <div className="text-2xl font-bold">
              ${items.length > 0 ? (getTotalRevenue() / items.length).toFixed(2) : '0.00'}
            </div>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card/60">
            <div className="flex flex-col items-center justify-center py-16">
              <h3 className="text-sm font-medium mb-1">No items in this show</h3>
              <p className="text-xs text-muted-foreground mb-4 text-center max-w-md">
                Add items from your inventory to start building your show list
              </p>
              <Button size="sm" onClick={() => setShowAddDialog(true)}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Add Items
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {categories.map((category) => {
              const categoryItems = getItemsByCategory(category);
              if (categoryItems.length === 0) return null;

              return (
                <div key={category} className="rounded-xl border border-border/50 bg-card/60">
                  <div className="px-5 py-4 border-b border-border/40">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-[15px]">{category}</h3>
                      <Badge variant="outline" className="text-xs border-border/60">
                        {categoryItems.length} items
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Estimated revenue: ${categoryItems.reduce((sum, item) => sum + item.start_price, 0).toFixed(2)}
                    </p>
                  </div>
                  <div className="p-2">
                    <div className="space-y-0.5">
                      {categoryItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-3 rounded-lg hover:bg-secondary/40 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              {item.inventory_items.product_name}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {item.inventory_items.console} -- {item.inventory_items.condition}
                            </div>
                          </div>
                          <div className="flex items-center gap-4 flex-shrink-0">
                            <div className="text-right">
                              <div className="text-sm font-medium">
                                ${item.start_price.toFixed(2)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Cost: ${item.inventory_items.purchase_price.toFixed(2)}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground/40 hover:text-destructive"
                              onClick={() => handleRemoveItem(item.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <AddToShowDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          showId={params.id as string}
          onSuccess={loadShowData}
        />
      </div>
    </DashboardLayout>
  );
}
