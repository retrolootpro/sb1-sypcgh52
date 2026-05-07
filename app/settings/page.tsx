'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Key, CircleCheck as CheckCircle, CircleAlert as AlertCircle, Plus, Trash2, Eye, EyeOff, ShieldCheck, Image, Plug, Bell, Save } from 'lucide-react';
import { EbayConnectCard } from '@/components/ebay-connect-card';
import { AmazonConnectCard } from '@/components/amazon-connect-card';
import { WhatnotConnectCard } from '@/components/whatnot-connect-card';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { normalizeStaleThreshold, readStaleThresholdDays, writeStaleThresholdDays } from '@/lib/inventory-aging';

type ApiKey = {
  id: string;
  provider: string;
  api_key: string;
  status: string;
  created_at: string;
};

const API_SERVICES = [
  {
    name: 'ebay_app_id',
    label: 'eBay Developer App ID',
    description: 'Powers live eBay sold-listing market pricing. Free at developer.ebay.com — create an app and copy the Production App ID.',
    required: true,
  },
  {
    name: 'pricecharting',
    label: 'PriceCharting',
    description: 'Video game titles, platforms, and market pricing data',
    required: false,
  },
  {
    name: 'barcode_lookup',
    label: 'Barcode Lookup',
    description: 'Product images and metadata from barcodelookup.com',
    required: false,
  },
  {
    name: 'upc_lookup',
    label: 'UPCitemDB',
    description: 'Alternative barcode lookup with product images',
    required: false,
  },
  {
    name: 'rawg',
    label: 'RAWG.io',
    description: 'Game image fallback — searches by title when no barcode image is found. Works without a key (add one for higher rate limits).',
    required: false,
    optional: true,
  },
  {
    name: 'google_search',
    label: 'Google Image Search',
    description: 'Finds stock photos for any item with no image. Enter your key as API_KEY:CX_ID (get both from console.cloud.google.com and cse.google.com).',
    required: false,
    optional: true,
  },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyService, setNewKeyService] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [staleDaysInput, setStaleDaysInput] = useState('60');
  const toastShown = useRef(false);

  useEffect(() => {
    if (toastShown.current) return;
    const ebayParam = searchParams.get('ebay');
    const amazonParam = searchParams.get('amazon');
    if (ebayParam === 'connected') {
      toastShown.current = true;
      toast.success('eBay account connected successfully');
    } else if (ebayParam === 'error') {
      toastShown.current = true;
      toast.error('Failed to connect eBay account. Please try again.');
    } else if (amazonParam === 'connected') {
      toastShown.current = true;
      toast.success('Amazon Seller account connected successfully');
    } else if (amazonParam === 'error') {
      toastShown.current = true;
      toast.error('Failed to connect Amazon account. Please try again.');
    }
    const whatnotParam = searchParams.get('whatnot');
    if (!toastShown.current && whatnotParam === 'connected') {
      toastShown.current = true;
      toast.success('Whatnot account connected successfully');
    } else if (!toastShown.current && whatnotParam === 'error') {
      toastShown.current = true;
      toast.error('Failed to connect Whatnot account. Please try again.');
    }
  }, [searchParams]);

  const loadApiKeys = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('user_api_keys')
        .select('*')
        .eq('user_id', user!.id)
        .order('provider');

      if (error) throw error;
      setApiKeys(data as ApiKey[]);
    } catch (error) {
      console.error('Error loading API keys:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadApiKeys();
    }
  }, [user, loadApiKeys]);

  useEffect(() => {
    setStaleDaysInput(String(readStaleThresholdDays()));
  }, []);

  const handleSaveAgingThreshold = () => {
    const days = normalizeStaleThreshold(staleDaysInput);
    writeStaleThresholdDays(days);
    setStaleDaysInput(String(days));
    toast.success(`Inventory aging alerts set to ${days} day${days === 1 ? '' : 's'}`);
  };

  const handleSaveKey = async (serviceName: string) => {
    if (!user || !newKeyValue.trim()) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('user_api_keys')
        .upsert(
          {
            user_id: user.id,
            provider: serviceName,
            api_key: newKeyValue.trim(),
            status: 'active',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,provider' }
        );

      if (error) throw error;

      toast.success(`${serviceName} API key saved`);
      setNewKeyValue('');
      setNewKeyService('');
      loadApiKeys();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save API key');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteKey = async (key: ApiKey) => {
    try {
      const { error } = await supabase
        .from('user_api_keys')
        .delete()
        .eq('id', key.id);

      if (error) throw error;
      toast.success(`${key.provider} API key removed`);
      loadApiKeys();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete API key');
    }
  };

  const toggleKeyVisibility = (keyId: string) => {
    setShowKey(prev => ({ ...prev, [keyId]: !prev[keyId] }));
  };

  return (
    <DashboardLayout>
      <div className="p-8 lg:p-10 space-y-8 max-w-3xl">
        <div>
          <div className="label-caps mb-1">Account</div>
          <h1 className="heading-lg text-[22px]">Settings</h1>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-[15px]">Inventory Aging Alerts</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Flag items that have been in stock long enough to consider discounting, relisting, or moving to another sales channel.
            </p>
          </div>

          <div className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="text-sm font-medium">Review threshold</label>
                <div className="mt-1.5 flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={staleDaysInput}
                    onChange={(event) => setStaleDaysInput(event.target.value)}
                    className="h-11 max-w-[140px] bg-secondary/40"
                  />
                  <span className="text-sm text-muted-foreground">days in stock</span>
                </div>
              </div>
              <Button className="h-11" onClick={handleSaveAgingThreshold}>
                <Save className="mr-2 h-4 w-4" />
                Save Alert
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-[15px]">API Keys</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure API keys for barcode lookup and pricing services
            </p>
          </div>

          <div className="p-5 space-y-6">
            {API_SERVICES.map((service, index) => {
              const existingKey = apiKeys.find(k => k.provider === service.name);
              const isConfiguring = newKeyService === service.name;
              const isActive = existingKey?.status === 'active';

              return (
                <div key={service.name} className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{service.label}</span>
                        {service.optional && (
                          <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/10">
                            <Image className="w-2.5 h-2.5 mr-1" />
                            Image Fallback
                          </Badge>
                        )}
                        {existingKey ? (
                          <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                            <CheckCircle className="w-2.5 h-2.5 mr-1" />
                            Active
                          </Badge>
                        ) : service.optional ? (
                          <Badge variant="outline" className="text-[10px] border-border/50 text-muted-foreground">
                            Optional
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/10">
                            <AlertCircle className="w-2.5 h-2.5 mr-1" />
                            Not Set
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{service.description}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {existingKey && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => toggleKeyVisibility(existingKey.id)}
                          >
                            {showKey[existingKey.id] ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteKey(existingKey)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                      {!isConfiguring && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => {
                            setNewKeyService(service.name);
                            setNewKeyValue('');
                          }}
                        >
                          <Plus className="w-3.5 h-3.5 mr-1" />
                          {existingKey ? 'Update' : 'Add Key'}
                        </Button>
                      )}
                    </div>
                  </div>

                  {existingKey && showKey[existingKey.id] && (
                    <div className="p-3 rounded-lg bg-secondary/30 font-mono text-xs text-muted-foreground break-all">
                      {existingKey.api_key}
                    </div>
                  )}

                  {isConfiguring && (
                    <div className="flex gap-2">
                      <Input
                        placeholder={`Enter ${service.label} API key...`}
                        value={newKeyValue}
                        onChange={(e) => setNewKeyValue(e.target.value)}
                        type="password"
                        className="bg-secondary/40 border-border/60 h-9 text-sm flex-1"
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveKey(service.name)}
                      />
                      <Button
                        size="sm"
                        className="h-9"
                        onClick={() => handleSaveKey(service.name)}
                        disabled={saving || !newKeyValue.trim()}
                      >
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9"
                        onClick={() => {
                          setNewKeyService('');
                          setNewKeyValue('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}

                  {index < API_SERVICES.length - 1 && (
                    <div className="border-t border-border/30" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Plug className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-[15px]">Platform Integrations</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect marketplace accounts to sync orders directly into the Shipping Hub
            </p>
          </div>
          <div className="p-5 space-y-5">
            <EbayConnectCard />
            <div className="border-t border-border/30" />
            <AmazonConnectCard />
            <div className="border-t border-border/30" />
            <WhatnotConnectCard />
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-[15px]">Security</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            API keys are stored securely. Use dedicated read-only keys where possible. Never share your keys publicly.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
