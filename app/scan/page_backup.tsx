'use client';

import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { BarcodeScannerView } from '@/components/barcode-scanner-view';
import { ScanResult } from '@/lib/barcode-scanner';
import { Camera, Keyboard, History, CircleCheck as CheckCircle2, CircleAlert as AlertCircle, Loader as Loader2, Undo2, Trash2, User } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { classifyItem, normalizeTitle, calculateConfidence, extractPlatform, detectEdition } from '@/lib/barcode-lookup';
import { lookupUPC, getActiveEmployees, type Employee } from '@/lib/api-services';
import { getPricingData, getPricingStatusMessage, toDatabaseStatus, type PricingResult } from '@/lib/pricing-service';

type ScanMode = 'single' | 'continuous';

type QueueItem = {
  id: string;
  barcode: string;
  status: 'scanning' | 'looking_up' | 'pricing' | 'added' | 'needs_review' | 'failed';
  scannedAt: number;
  result?: any;
  error?: string;
};

export default function ScanPage() {
  const { user } = useAuth();
  const [scanMode, setScanMode] = useState<ScanMode>('single');
  const [scannerActive, setScannerActive] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [recentScans, setRecentScans] = useState<string[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    loadEmployees();
  }, []);

  const loadEmployees = async () => {
    try {
      const activeEmployees = await getActiveEmployees();
      setEmployees(activeEmployees);
    } catch (error) {
      console.error('Error loading employees:', error);
    }
  };

  const handleScan = async (result: ScanResult) => {
    if (recentScans.includes(result.barcode)) {
      toast.info('Already in queue', { duration: 1500 });
      return;
    }

    const queueItem: QueueItem = {
      id: `scan-${Date.now()}`,
      barcode: result.barcode,
      status: 'scanning',
      scannedAt: result.timestamp,
    };

    setQueue((prev) => [queueItem, ...prev]);
    setRecentScans((prev) => [result.barcode, ...prev].slice(0, 20));

    if (scanMode === 'single') {
      setScannerActive(false);
    }

    await processBarcode(queueItem);
  };

  const processBarcode = async (queueItem: QueueItem) => {
    try {
      console.log(`[Scan Flow] ═══════════════════════════════════════`);
      console.log(`[Scan Flow] 🔍 Starting scan for barcode: ${queueItem.barcode}`);
      console.log(`[Scan Flow] ═══════════════════════════════════════`);

      updateQueueItem(queueItem.id, { status: 'looking_up' });

      console.log(`[Scan Flow] 📡 Looking up UPC in barcode database...`);

      let upcLookupResult;
      try {
        upcLookupResult = await lookupUPC(queueItem.barcode, user!.id);
      } catch (lookupError: any) {
        console.error(`[Scan Flow] ❌ UPC lookup failed:`, lookupError.message);
        if (lookupError.message?.includes('API key not configured')) {
          throw new Error('Please configure a barcode lookup API key in Settings');
        }
        throw lookupError;
      }

      if (!upcLookupResult) {
        console.error(`[Scan Flow] ❌ No product found for barcode`);
        throw new Error('Product not found in any database');
      }

      if (!upcLookupResult.title || upcLookupResult.title.trim().length === 0) {
        console.error(`[Scan Flow] ❌ Invalid product data: missing title`);
        throw new Error('Invalid product data: missing title');
      }

      console.log(`[Scan Flow] ✅ UPC lookup successful`);
      console.log(`[Scan Flow]    Title: "${upcLookupResult.title}"`);
      console.log(`[Scan Flow]    Brand: ${upcLookupResult.brand || 'Unknown'}`);
      console.log(`[Scan Flow]    Category: ${upcLookupResult.category || 'Unknown'}`);

      const classification = classifyItem(
        upcLookupResult.title,
        upcLookupResult.category || '',
        upcLookupResult.brand || ''
      );

      const platform = extractPlatform(upcLookupResult.title);
      const edition = detectEdition(upcLookupResult.title);

      let pricingResult: PricingResult | null = null;
      if (classification.itemType === 'game' || classification.itemType === 'console') {
        updateQueueItem(queueItem.id, { status: 'pricing' });

        console.log(`[Scan Flow] 🔍 Initiating pricing lookup...`);
        console.log(`[Scan Flow]    Barcode: ${queueItem.barcode}`);
        console.log(`[Scan Flow]    Title: "${upcLookupResult.title}"`);
        console.log(`[Scan Flow]    Platform: "${platform || 'Unknown'}"`);

        try {
          pricingResult = await getPricingData(
            upcLookupResult.title,
            platform || 'Unknown',
            user!.id
          );

          if (pricingResult.status === 'success' && pricingResult.data) {
            console.log(`[Scan Flow] ✅ PRICING SUCCESS`);
            console.log(`[Scan Flow]    Matched: "${pricingResult.data.matchedTitle}"`);
            console.log(`[Scan Flow]    Platform: ${pricingResult.data.matchedPlatform}`);
            console.log(`[Scan Flow]    Strategy: ${pricingResult.data.strategy}`);
            console.log(`[Scan Flow]    Confidence: ${pricingResult.data.confidence}%`);
            console.log(`[Scan Flow]    Loose: $${pricingResult.data.loosePrice}`);
            console.log(`[Scan Flow]    CIB: $${pricingResult.data.cibPrice}`);
            console.log(`[Scan Flow]    New: $${pricingResult.data.newPrice}`);
            if (pricingResult.data.gradedPrice && pricingResult.data.gradedPrice > 0) {
              console.log(`[Scan Flow]    Graded: $${pricingResult.data.gradedPrice}`);
            }
          } else if (pricingResult.status === 'no_match') {
            console.log(`[Scan Flow] ℹ️ No PriceCharting match`);
            if (pricingResult.attemptedQueries) {
              console.log(`[Scan Flow]    Tried: ${pricingResult.attemptedQueries.join(', ')}`);
            }
          } else if (pricingResult.status === 'config_error') {
            console.warn(`[Scan Flow] ⚠️ API key not configured`);
            console.warn(`[Scan Flow]    ${pricingResult.error}`);
          } else {
            console.error(`[Scan Flow] ❌ Pricing failed: ${pricingResult.status}`);
            console.error(`[Scan Flow]    ${pricingResult.error || 'Unknown error'}`);
          }
        } catch (pricingError) {
          console.error('[Scan Flow] ❌ Pricing exception:', pricingError);
          pricingResult = {
            status: 'api_error',
            error: pricingError instanceof Error ? pricingError.message : 'Unknown exception',
          };
        }
      } else {
        console.log(`[Scan Flow] ⏭️ Skipping pricing (item type: ${classification.itemType})`);
      }

      const hasPricing = pricingResult?.status === 'success' && pricingResult.data !== undefined;

      const confidence = calculateConfidence({
        barcodeMatch: true,
        titleSimilarity: 100,
        platformMatch: platform !== null,
        itemTypeConfidence: classification.confidence,
        hasImage: !!upcLookupResult.imageUrl,
        hasPricing,
        editionMatch: edition !== null,
      });

      const result = {
        ...upcLookupResult,
        platform,
        edition,
        pricingResult,
        classification,
        confidence,
      };

      if (confidence.overall >= 85) {
        await createInventoryItem(queueItem, result, classification, confidence, pricingResult);
        updateQueueItem(queueItem.id, { status: 'added', result });

        console.log(`[Scan Flow] ✅ SCAN COMPLETE - Item added to inventory`);
        console.log(`[Scan Flow] ═══════════════════════════════════════`);

        const pricingMsg = pricingResult?.status === 'success'
          ? `with pricing ($${pricingResult.data?.loosePrice} loose)`
          : getPricingStatusMessage(pricingResult!);

        toast.success(`✓ ${upcLookupResult.title}`, {
          description: pricingMsg,
          duration: 2000
        });
      } else {
        await sendToReviewQueue(queueItem, result, classification, confidence);
        updateQueueItem(queueItem.id, { status: 'needs_review', result });

        console.log(`[Scan Flow] ⚠️ SCAN COMPLETE - Sent to review queue`);
        console.log(`[Scan Flow]    Reason: Low confidence (${confidence.overall}%)`);
        console.log(`[Scan Flow] ═══════════════════════════════════════`);

        toast.warning(`⚠ ${upcLookupResult.title} - Needs Review`, { duration: 3000 });
      }
    } catch (error: any) {
      console.error('Barcode processing error:', error);
      const errorMessage = error.message || 'Unknown error occurred';
      updateQueueItem(queueItem.id, { status: 'failed', error: errorMessage });

      if (errorMessage.includes('API key')) {
        toast.error('Configuration Required', {
          description: errorMessage,
          duration: 5000,
        });
      } else if (errorMessage.includes('not found')) {
        toast.error('Not Found', {
          description: `Barcode ${queueItem.barcode} not in database`,
          duration: 3000,
        });
      } else {
        toast.error('Scan Failed', {
          description: errorMessage,
          duration: 4000,
        });
      }
    }
  };

  const createInventoryItem = async (
    queueItem: QueueItem,
    lookupResult: any,
    classification: any,
    confidence: any,
    pricingResult: PricingResult | null
  ) => {
    try {
      // Determine pricing status using helper
      const pricingStatus = pricingResult ? toDatabaseStatus(pricingResult) : 'pending';
      const pricingErrorMessage = pricingResult?.error || null;
      const pricingConfidence = pricingResult?.data?.confidence || null;
      const pricingMatchedTitle = pricingResult?.data?.matchedTitle || null;
      const pricingMatchedPlatform = pricingResult?.data?.matchedPlatform || null;
      const pricingStrategy = pricingResult?.data?.strategy || null;

      console.log(`[Scan Flow] 💾 Saving to inventory...`);
      console.log(`[Scan Flow]    Pricing status: ${pricingStatus}`);

      const { data: inventoryItem, error: inventoryError } = await supabase
        .from('inventory_items')
        .insert({
          user_id: user!.id,
          product_name: lookupResult.title?.trim() || 'Unknown Product',
          console: lookupResult.platform || (classification.itemType === 'game' ? 'Unknown' : ''),
          condition: 'Loose',
          purchase_price: 0,
          quantity: 1,
          barcode: queueItem.barcode,
          normalized_title: normalizeTitle(lookupResult.title || ''),
          item_type: classification.itemType || 'unknown',
          brand: lookupResult.brand || null,
          confidence_score: confidence.overall || 0,
          source_upc_provider: 'upcitemdb',
          source_metadata_provider: pricingResult?.status === 'success' ? 'pricecharting' : null,
          source_image_provider: lookupResult.imageUrl ? 'upcitemdb' : null,
          scan_created_at: new Date().toISOString(),
          image_url: lookupResult.imageUrl || null,
          thumbnail_url: lookupResult.thumbnailUrl || null,
          added_by_employee_id: selectedEmployeeId || null,
          pricing_status: pricingStatus,
          pricing_attempted_at: new Date().toISOString(),
          pricing_error_message: pricingErrorMessage,
          pricing_confidence: pricingConfidence,
          pricing_matched_title: pricingMatchedTitle,
          pricing_matched_platform: pricingMatchedPlatform,
        })
        .select()
        .single();

      if (inventoryError) {
        console.error('Inventory insert error:', inventoryError);
        throw new Error(`Failed to save item: ${inventoryError.message}`);
      }

      if (!inventoryItem) {
        throw new Error('Failed to create inventory item - no data returned');
      }

      if (pricingResult?.status === 'success' && pricingResult.data) {
        try {
          const loosePrice = Number(pricingResult.data.loosePrice) || 0;
          const cibPrice = Number(pricingResult.data.cibPrice) || 0;
          const newPrice = Number(pricingResult.data.newPrice) || 0;

          console.log('[Scan Flow] 💰 Saving pricing data to database...');

          const { data: pricingInsertData, error: pricingError } = await supabase
            .from('pricing_data')
            .insert({
              item_id: inventoryItem.id,
              loose_price: loosePrice,
              cib_price: cibPrice,
              new_price: newPrice,
              fetched_at: new Date().toISOString(),
            })
            .select();

          if (pricingError) {
            console.error('[Scan Flow] ❌ Pricing insert failed:', pricingError.message);
          } else {
            console.log('[Scan Flow] ✅ Pricing data saved successfully');
          }
        } catch (pricingErr) {
          console.error('[Scan Flow] ❌ Pricing insert exception:', pricingErr);
        }
      } else {
        console.log(`[Scan Flow] ⏭️ Skipping pricing insert (status: ${pricingStatus})`);
      }

      return inventoryItem;
    } catch (error) {
      console.error('Error creating inventory item:', error);
      throw error;
    }
  };

  const sendToReviewQueue = async (
    queueItem: QueueItem,
    lookupResult: any,
    classification: any,
    confidence: any
  ) => {
    try {
      const { error } = await supabase.from('review_queue').insert({
        user_id: user!.id,
        barcode: queueItem.barcode,
        detected_title: lookupResult.title?.trim() || 'Unknown Product',
        item_type: classification.itemType || 'unknown',
        brand: lookupResult.brand || null,
        detected_image_url: lookupResult.imageUrl || null,
        confidence_score: confidence.overall || 0,
        ranking_reason: confidence.explanation || 'Low confidence match',
        raw_lookup_data: lookupResult,
      });

      if (error) {
        console.error('Review queue insert error:', error);
        throw new Error(`Failed to add to review queue: ${error.message}`);
      }
    } catch (error) {
      console.error('Error sending to review queue:', error);
      throw error;
    }
  };

  const updateQueueItem = (id: string, updates: Partial<QueueItem>) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualBarcode.trim()) return;

    handleScan({
      barcode: manualBarcode.trim(),
      format: 'manual',
      timestamp: Date.now(),
    });

    setManualBarcode('');
  };

  const handleUndo = async () => {
    if (queue.length === 0) return;
    const lastItem = queue[0];

    if (lastItem.status === 'added') {
      try {
        await supabase
          .from('inventory_items')
          .delete()
          .eq('barcode', lastItem.barcode)
          .eq('user_id', user!.id)
          .order('created_at', { ascending: false })
          .limit(1);
      } catch (error) {
        console.error('Error undoing:', error);
      }
    } else if (lastItem.status === 'needs_review') {
      try {
        await supabase
          .from('review_queue')
          .delete()
          .eq('barcode', lastItem.barcode)
          .eq('user_id', user!.id)
          .order('created_at', { ascending: false })
          .limit(1);
      } catch (error) {
        console.error('Error undoing:', error);
      }
    }

    setQueue((prev) => prev.slice(1));
    setRecentScans((prev) => prev.filter((code) => code !== lastItem.barcode));
    toast.success('Undone');
  };

  const clearQueue = () => {
    setQueue([]);
    setRecentScans([]);
    toast.success('Queue cleared');
  };

  const getStatusIcon = (status: QueueItem['status']) => {
    switch (status) {
      case 'scanning':
      case 'looking_up':
      case 'pricing':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-400" />;
      case 'added':
        return <CheckCircle2 className="w-4 h-4 text-green-400" />;
      case 'needs_review':
        return <AlertCircle className="w-4 h-4 text-yellow-400" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-400" />;
    }
  };

  const getStatusLabel = (status: QueueItem['status']) => {
    switch (status) {
      case 'scanning':
        return 'Scanning...';
      case 'looking_up':
        return 'Looking up...';
      case 'pricing':
        return 'Getting prices...';
      case 'added':
        return 'Added';
      case 'needs_review':
        return 'Needs Review';
      case 'failed':
        return 'Failed';
    }
  };

  return (
    <DashboardLayout>
      <div className="p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scan Inventory</h1>
          <p className="text-muted-foreground">
            Scan barcodes to quickly add items to your inventory
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Scan Mode</CardTitle>
              <CardDescription>Choose how you want to scan items</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {employees.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="employee-select" className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Employee (Optional)
                  </Label>
                  <Select
                    value={selectedEmployeeId || 'none'}
                    onValueChange={(value) => setSelectedEmployeeId(value === 'none' ? null : value)}
                  >
                    <SelectTrigger id="employee-select">
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {employees.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant={scanMode === 'single' ? 'default' : 'outline'}
                  onClick={() => setScanMode('single')}
                  className="w-full"
                >
                  Single Scan
                </Button>
                <Button
                  variant={scanMode === 'continuous' ? 'default' : 'outline'}
                  onClick={() => setScanMode('continuous')}
                  className="w-full"
                >
                  Continuous
                </Button>
              </div>

              <div className="space-y-3">
                <Button
                  onClick={() => setScannerActive(true)}
                  className="w-full"
                  size="lg"
                >
                  <Camera className="w-5 h-5 mr-2" />
                  Start Camera
                </Button>

                <form onSubmit={handleManualSubmit} className="flex gap-2">
                  <Input
                    placeholder="Enter barcode manually"
                    value={manualBarcode}
                    onChange={(e) => setManualBarcode(e.target.value)}
                    className="bg-secondary/50"
                  />
                  <Button type="submit" variant="outline">
                    <Keyboard className="w-4 h-4" />
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Processing Queue</span>
                {queue.length > 0 && (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleUndo}
                    >
                      <Undo2 className="w-4 h-4 mr-1" />
                      Undo
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearQueue}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Clear
                    </Button>
                  </div>
                )}
              </CardTitle>
              <CardDescription>
                {queue.length} item{queue.length !== 1 ? 's' : ''} in queue
              </CardDescription>
            </CardHeader>
            <CardContent>
              {queue.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No items scanned yet</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {queue.slice(0, 15).map((item, index) => (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between p-3 rounded-lg transition-all ${
                        item.status === 'added'
                          ? 'bg-green-500/10 border border-green-500/30'
                          : item.status === 'needs_review'
                          ? 'bg-yellow-500/10 border border-yellow-500/30'
                          : item.status === 'failed'
                          ? 'bg-red-500/10 border border-red-500/30'
                          : 'bg-secondary/30 border border-transparent'
                      } ${index === 0 ? 'ring-2 ring-primary/20' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          {item.result?.title || item.barcode}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {item.barcode}
                        </div>
                        {item.error && (
                          <div className="text-xs text-red-400 mt-1">
                            {item.error}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(item.status)}
                        <Badge
                          variant="outline"
                          className={
                            item.status === 'added'
                              ? 'border-green-500/50 text-green-400'
                              : item.status === 'needs_review'
                              ? 'border-yellow-500/50 text-yellow-400'
                              : item.status === 'failed'
                              ? 'border-red-500/50 text-red-400'
                              : 'border-white/20'
                          }
                        >
                          {getStatusLabel(item.status)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <BarcodeScannerView
        isActive={scannerActive}
        onScan={handleScan}
        onStop={() => setScannerActive(false)}
      />
    </DashboardLayout>
  );
}
