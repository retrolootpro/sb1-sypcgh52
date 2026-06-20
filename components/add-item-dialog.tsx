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
import { CONDITIONS, PLATFORM_OPTIONS, REGIONS } from '@/lib/constants';
import { getCanonicalPricing } from '@/lib/pricing-service';
import { calculateDealScore, getMarketValueByCondition } from '@/lib/deal-score';
import { defaultConditionForPlatform, isBookLikeValue } from '@/lib/item-taxonomy';
import { lookupUPC, type UPCLookupResult } from '@/lib/api-services';
import { BookOpen, Search } from 'lucide-react';

type AddItemDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  defaultCollectionId?: string | null;
  defaultLotId?: string | null;
};

type Lot = { id: string; name: string };

export function AddItemDialog({ open, onOpenChange, onSuccess, defaultCollectionId, defaultLotId }: AddItemDialogProps) {
  const { user, accountId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [bookLookupLoading, setBookLookupLoading] = useState(false);
  const [bookLookupResult, setBookLookupResult] = useState<UPCLookupResult | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [formData, setFormData] = useState({
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

  const resetForm = () => {
    setBookLookupResult(null);
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
  };

  useEffect(() => {
    if (open && user && accountId) {
      supabase
        .from('lots')
        .select('id, name')
        .eq('user_id', accountId)
        .order('received_at', { ascending: false })
        .then(({ data }) => setLots(data || []));
    }
  }, [open, user, accountId]);

  useEffect(() => {
    if (defaultLotId !== undefined) {
      setFormData(prev => ({ ...prev, lot_id: defaultLotId ?? '' }));
    }
  }, [defaultLotId]);

  const handleBookMetadataLookup = async () => {
    if (!user || !accountId) {
      toast.error('Log in before looking up book metadata');
      return;
    }

    const barcode = formData.barcode.trim();
    if (!barcode) {
      toast.error('Enter or scan the book UPC / ISBN first');
      return;
    }

    setBookLookupLoading(true);
    try {
      const result = await lookupUPC(barcode, accountId || user.id, undefined, 'book');
      if (!result) throw new Error('No book metadata found');

      const metadata = result.bookMetadata;
      setBookLookupResult(result);
      setFormData((prev) => ({
        ...prev,
        product_name: result.title || metadata?.title || prev.product_name,
        console: result.platform || prev.console || 'Book',
        condition: prev.condition || defaultConditionForPlatform(result.platform || 'Book'),
        notes: prev.notes || metadata?.description || result.description || '',
      }));
      toast.success('Book metadata found', {
        description: result.title || barcode,
      });
    } catch (error: unknown) {
      setBookLookupResult(null);
      toast.warning((error as Error).message || 'No book metadata found. You can still save it manually.');
    } finally {
      setBookLookupLoading(false);
    }
  };

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
      if (!user || !accountId) throw new Error('Not authenticated');
      const manualPricedItem = isBookLikeValue(formData.console);
      const bookMetadata = bookLookupResult?.bookMetadata || null;
      const bookRetailPrice = Number(bookMetadata?.retailPrice) || 0;
      const manualEstimatedProfit = bookRetailPrice > 0 ? bookRetailPrice - price : 0;
      const manualEstimatedMarginPercent = bookRetailPrice > 0 && price > 0 ? (manualEstimatedProfit / price) * 100 : 0;
      const { data: inventoryItem, error } = await supabase
        .from('inventory_items')
        .insert({
          user_id: accountId,
          product_name: formData.product_name.trim(),
          console: formData.console,
          condition: formData.condition,
          region: formData.region,
          purchase_price: price,
          quantity: qty,
          notes: formData.notes?.trim() || null,
          barcode: formData.barcode?.trim() || null,
          description: bookLookupResult?.description || bookMetadata?.description || null,
          brand: bookLookupResult?.brand || bookMetadata?.publisher || null,
          image_url: bookLookupResult?.imageUrl || bookMetadata?.coverImageUrl || null,
          thumbnail_url: bookLookupResult?.thumbnailUrl || bookMetadata?.coverImageUrl || null,
          collection_id: defaultCollectionId || null,
          lot_id: formData.lot_id || null,
          category: manualPricedItem ? (bookLookupResult?.category || 'Books & Media') : 'Video Games',
          item_type: manualPricedItem ? (formData.console === 'Manga' ? 'manga' : 'book') : 'game',
          pricing_source: manualPricedItem ? 'Manual / book metadata' : 'pending',
          pricing_status: manualPricedItem ? 'manual' : 'pending',
          sell_price: manualPricedItem && bookRetailPrice > 0 ? bookRetailPrice : null,
          selected_market_value: manualPricedItem && bookRetailPrice > 0 ? bookRetailPrice : null,
          estimated_profit: manualPricedItem && bookRetailPrice > 0 ? manualEstimatedProfit : null,
          estimated_margin_percent: manualPricedItem && bookRetailPrice > 0 ? manualEstimatedMarginPercent : null,
          source_metadata_provider: bookLookupResult?.source || 'manual_entry',
          source_upc_provider: bookLookupResult?.source || null,
          raw_lookup_payload: bookMetadata ? {
            type: 'book_metadata',
            barcode: formData.barcode?.trim() || '',
            title: bookMetadata.title || bookLookupResult?.title || '',
            subtitle: bookMetadata.subtitle || '',
            authors: Array.isArray(bookMetadata.authors) ? bookMetadata.authors : [],
            publisher: bookMetadata.publisher || '',
            publishedDate: bookMetadata.publishedDate || '',
            publishedYear: bookMetadata.publishedYear || '',
            description: bookMetadata.description || bookLookupResult?.description || '',
            pageCount: bookMetadata.pageCount ?? null,
            categories: Array.isArray(bookMetadata.categories) ? bookMetadata.categories : [],
            language: bookMetadata.language || '',
            isbn10: bookMetadata.isbn10 || '',
            isbn13: bookMetadata.isbn13 || '',
            coverImageUrl: bookMetadata.coverImageUrl || bookLookupResult?.imageUrl || '',
            retailPrice: Number(bookMetadata.retailPrice) || null,
            retailPriceCurrency: bookMetadata.retailPriceCurrency || '',
            retailPriceSource: bookMetadata.retailPriceSource || '',
            source: bookMetadata.source || bookLookupResult?.source || '',
            sourcesTried: Array.isArray(bookMetadata.sourcesTried) ? bookMetadata.sourcesTried : [],
          } : {},
        })
        .select()
        .single();

      if (error) throw new Error(error.message || 'Failed to add item');
      if (!inventoryItem) throw new Error('Item created but no data returned');

      if (!manualPricedItem) {
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

            const { error: pricingUpdateError } = await supabase
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

            if (pricingUpdateError) throw pricingUpdateError;

            const { error: pricingDataError } = await supabase.from('pricing_data').insert({
              item_id: inventoryItem.id,
              loose_price: loosePrice,
              cib_price: cibPrice,
              new_price: newPrice,
              fetched_at: new Date().toISOString(),
            });
            if (pricingDataError) throw pricingDataError;
          }
        } catch (pricingError) {
          console.error('[Add Item] Pricing refresh failed:', pricingError);
          toast.warning('Item was added, but pricing could not be refreshed automatically.');
        }
      }

      toast.success('Item added successfully!');
      resetForm();
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
            Add games, books, manga, comics, or other resale inventory. Book and media items use manual pricing by default.
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
                <Label htmlFor="console">Platform / Category</Label>
                <Select
                  value={formData.console}
                  onValueChange={(value) => {
                    setBookLookupResult(isBookLikeValue(value) ? bookLookupResult : null);
                    setFormData({ ...formData, console: value, condition: defaultConditionForPlatform(value) });
                  }}
                >
                  <SelectTrigger className="bg-secondary/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORM_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="condition">Condition</Label>
                <Select
                  value={formData.condition}
                  onValueChange={(value) => setFormData({ ...formData, condition: value })}
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
              <Label htmlFor="barcode">Barcode / UPC / ISBN <span className="text-muted-foreground font-normal">(Optional)</span></Label>
              <div className="flex gap-2">
                <Input
                  id="barcode"
                  placeholder={isBookLikeValue(formData.console) ? 'Scan or enter ISBN / book barcode' : 'Enter barcode'}
                  value={formData.barcode}
                  onChange={(e) => {
                    setBookLookupResult(null);
                    setFormData({ ...formData, barcode: e.target.value });
                  }}
                  className="bg-secondary/50"
                />
                {isBookLikeValue(formData.console) && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBookMetadataLookup}
                    disabled={bookLookupLoading || !formData.barcode.trim()}
                    className="shrink-0"
                  >
                    {bookLookupLoading ? (
                      'Looking...'
                    ) : (
                      <>
                        <Search className="mr-2 h-4 w-4" />
                        Lookup
                      </>
                    )}
                  </Button>
                )}
              </div>
              {isBookLikeValue(formData.console) && (
                <p className="text-xs text-muted-foreground">
                  ISBN-10, ISBN-13, and Bookland EANs can auto-fill metadata. Retail UPCs are saved for search/POS even when no book metadata exists.
                </p>
              )}
              {bookLookupResult?.bookMetadata && (
                <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium text-primary">
                    <BookOpen className="h-4 w-4" />
                    Book metadata ready
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {[bookLookupResult.bookMetadata.authors?.join(', '), bookLookupResult.bookMetadata.publisher, bookLookupResult.bookMetadata.publishedYear].filter(Boolean).join(' - ')}
                  </div>
                </div>
              )}
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
