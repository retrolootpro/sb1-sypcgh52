'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Tv, ShoppingBag, Package2, Truck, User } from 'lucide-react';
import {
  getEmployeeById,
  getShowsByEmployee,
  getEbayListingsWithItemsByEmployee,
  getAmazonListingsWithItemsByEmployee,
  getItemsToShipByEmployee,
  getReceivedItemsByEmployee,
  type Employee,
  type ShowList,
  type EbayListingWithItem,
  type AmazonListingWithItem,
  type InventoryItemShipping,
} from '@/lib/api-services';
import { useAuth } from '@/lib/auth-context';
import { ShowsTab } from './shows-tab';
import { EbayTab } from './ebay-tab';
import { AmazonTab } from './amazon-tab';
import { ShippingTab } from './shipping-tab';

export default function EmployeeWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const employeeId = params.id as string;
  const { user, loading: authLoading } = useAuth();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [shows, setShows] = useState<ShowList[]>([]);
  const [ebayListings, setEbayListings] = useState<EbayListingWithItem[]>([]);
  const [amazonListings, setAmazonListings] = useState<AmazonListingWithItem[]>([]);
  const [itemsToShip, setItemsToShip] = useState<InventoryItemShipping[]>([]);
  const [receivedItems, setReceivedItems] = useState<InventoryItemShipping[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('shows');

  const loadAll = useCallback(async () => {
    try {
      const emp = await getEmployeeById(employeeId);
      setEmployee(emp);

      const [showsData, ebayData, amazonData, shipData, receivedData] = await Promise.allSettled([
        getShowsByEmployee(employeeId),
        getEbayListingsWithItemsByEmployee(employeeId),
        getAmazonListingsWithItemsByEmployee(employeeId),
        getItemsToShipByEmployee(employeeId),
        getReceivedItemsByEmployee(employeeId),
      ]);

      if (showsData.status === 'fulfilled') setShows(showsData.value);
      if (ebayData.status === 'fulfilled') setEbayListings(ebayData.value);
      if (amazonData.status === 'fulfilled') setAmazonListings(amazonData.value);
      if (shipData.status === 'fulfilled') setItemsToShip(shipData.value);
      if (receivedData.status === 'fulfilled') setReceivedItems(receivedData.value);
    } catch (err) {
      console.error('Failed to load employee:', err);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    if (!authLoading && user) {
      loadAll();
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [loadAll, authLoading, user]);

  const toShipCount = itemsToShip.filter(i => !i.shipping_status || i.shipping_status === 'pending').length;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-7 w-7 border-2 border-primary border-t-transparent" />
        </div>
      </DashboardLayout>
    );
  }

  if (!employee) {
    return (
      <DashboardLayout>
        <div className="p-8 lg:p-10">
          <div className="flex flex-col items-center justify-center py-16">
            <User className="w-10 h-10 text-muted-foreground/20 mb-3" />
            <h3 className="text-sm font-medium mb-1">Employee not found</h3>
            <Button size="sm" variant="outline" onClick={() => router.push('/employees')} className="mt-3">
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
              Back to Employees
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-8 lg:p-10 space-y-7 max-w-5xl">
        <div className="flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-white mt-0.5 shrink-0"
            onClick={() => router.push('/employees')}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="label-caps mb-1">Employee Workspace</div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="heading-lg text-[22px]">{employee.name}</h1>
              <Badge
                variant="outline"
                className={`text-[10px] ${employee.is_active ? 'border-emerald-500/30 text-emerald-400' : 'border-border/60 text-muted-foreground'}`}
              >
                {employee.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            {employee.email && (
              <div className="text-xs text-muted-foreground mt-1">{employee.email}</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={() => setActiveTab('shows')}
            className={`rounded-xl border p-4 text-left transition-all ${activeTab === 'shows' ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-border/40 bg-card/50 hover:border-border/60'}`}
          >
            <Tv className={`w-5 h-5 mb-2 ${activeTab === 'shows' ? 'text-cyan-400' : 'text-muted-foreground/50'}`} />
            <div className="text-lg font-bold">{shows.length}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Shows</div>
          </button>
          <button
            onClick={() => setActiveTab('ebay')}
            className={`rounded-xl border p-4 text-left transition-all ${activeTab === 'ebay' ? 'border-orange-500/40 bg-orange-500/5' : 'border-border/40 bg-card/50 hover:border-border/60'}`}
          >
            <ShoppingBag className={`w-5 h-5 mb-2 ${activeTab === 'ebay' ? 'text-orange-400' : 'text-muted-foreground/50'}`} />
            <div className="text-lg font-bold">{ebayListings.length}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">eBay Listings</div>
          </button>
          <button
            onClick={() => setActiveTab('amazon')}
            className={`rounded-xl border p-4 text-left transition-all ${activeTab === 'amazon' ? 'border-amber-500/40 bg-amber-500/5' : 'border-border/40 bg-card/50 hover:border-border/60'}`}
          >
            <Package2 className={`w-5 h-5 mb-2 ${activeTab === 'amazon' ? 'text-amber-400' : 'text-muted-foreground/50'}`} />
            <div className="text-lg font-bold">{amazonListings.length}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Amazon Listings</div>
          </button>
          <button
            onClick={() => setActiveTab('shipping')}
            className={`rounded-xl border p-4 text-left transition-all relative ${activeTab === 'shipping' ? 'border-sky-500/40 bg-sky-500/5' : 'border-border/40 bg-card/50 hover:border-border/60'}`}
          >
            {toShipCount > 0 && (
              <span className="absolute top-3 right-3 w-4 h-4 rounded-full bg-amber-500 text-[9px] font-bold text-black flex items-center justify-center">
                {toShipCount}
              </span>
            )}
            <Truck className={`w-5 h-5 mb-2 ${activeTab === 'shipping' ? 'text-sky-400' : 'text-muted-foreground/50'}`} />
            <div className="text-lg font-bold">{itemsToShip.length}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Ship & Receive</div>
          </button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-9 text-xs mb-2">
            <TabsTrigger value="shows" className="text-xs gap-1.5">
              <Tv className="w-3.5 h-3.5" />
              Whatnot Shows
            </TabsTrigger>
            <TabsTrigger value="ebay" className="text-xs gap-1.5">
              <ShoppingBag className="w-3.5 h-3.5" />
              eBay
            </TabsTrigger>
            <TabsTrigger value="amazon" className="text-xs gap-1.5">
              <Package2 className="w-3.5 h-3.5" />
              Amazon
            </TabsTrigger>
            <TabsTrigger value="shipping" className="text-xs gap-1.5">
              <Truck className="w-3.5 h-3.5" />
              Ship &amp; Receive
              {toShipCount > 0 && (
                <span className="ml-1 w-4 h-4 rounded-full bg-amber-500 text-[9px] font-bold text-black flex items-center justify-center">
                  {toShipCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="shows" className="mt-4">
            <ShowsTab employeeId={employeeId} shows={shows} onRefresh={loadAll} />
          </TabsContent>

          <TabsContent value="ebay" className="mt-4">
            <EbayTab employeeId={employeeId} listings={ebayListings} onRefresh={loadAll} />
          </TabsContent>

          <TabsContent value="amazon" className="mt-4">
            <AmazonTab employeeId={employeeId} listings={amazonListings} onRefresh={loadAll} />
          </TabsContent>

          <TabsContent value="shipping" className="mt-4">
            <ShippingTab
              itemsToShip={itemsToShip}
              receivedItems={receivedItems}
              onRefresh={loadAll}
            />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
