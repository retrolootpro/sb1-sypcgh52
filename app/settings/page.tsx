'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Key, CircleCheck as CheckCircle, CircleAlert as AlertCircle, Plus, Trash2, Eye, EyeOff, ShieldCheck, Image, Plug, Bell, Save, KeyRound, QrCode, Smartphone, Calculator, Palette } from 'lucide-react';
import { EbayConnectCard } from '@/components/ebay-connect-card';
import { AmazonConnectCard } from '@/components/amazon-connect-card';
import { WhatnotConnectCard } from '@/components/whatnot-connect-card';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { normalizeAgingThresholds, readAgingThresholds, writeAgingThresholds } from '@/lib/inventory-aging';
import { getAccountSecuritySettings, getAssuranceLevel, upsertAccountSecuritySettings, type AccountSecuritySettings } from '@/lib/security-services';
import { getPosTaxSettings, upsertPosTaxSettings, type PosTaxSettings } from '@/lib/pos-services';
import { ThemeSwitcher } from '@/components/theme-toggle';

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
  {
    name: 'google_books',
    label: 'Google Books',
    description: 'Optional free Google Books API key for ISBN book metadata. Helps avoid rate limits when scanning books.',
    required: false,
    optional: true,
  },
];

export default function SettingsPage() {
  const { user, accountId, isAdmin } = useAuth();
  const searchParams = useSearchParams();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyService, setNewKeyService] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [watchDaysInput, setWatchDaysInput] = useState('45');
  const [reviewDaysInput, setReviewDaysInput] = useState('60');
  const [securitySettings, setSecuritySettings] = useState<AccountSecuritySettings | null>(null);
  const [currentAal, setCurrentAal] = useState<string | null>(null);
  const [mfaFactors, setMfaFactors] = useState<any[]>([]);
  const [totpQr, setTotpQr] = useState('');
  const [totpFactorId, setTotpFactorId] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneFactorId, setPhoneFactorId] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [mfaChallengeCode, setMfaChallengeCode] = useState('');
  const [posTaxSettings, setPosTaxSettings] = useState<PosTaxSettings | null>(null);
  const [posTaxZip, setPosTaxZip] = useState('');
  const [posTaxRate, setPosTaxRate] = useState('0');
  const [posTaxSource, setPosTaxSource] = useState('manual');
  const [taxLookupLoading, setTaxLookupLoading] = useState(false);
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
    if (!accountId) return;
    try {
      const { data, error } = await supabase
        .from('user_api_keys')
        .select('*')
        .eq('user_id', accountId)
        .order('provider');

      if (error) throw error;
      setApiKeys(data as ApiKey[]);
    } catch (error) {
      console.error('Error loading API keys:', error);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (user && accountId) {
      loadApiKeys();
    }
  }, [user, accountId, loadApiKeys]);

  const loadPosTaxSettings = useCallback(async () => {
    if (!user || !accountId) return;
    try {
      const settings = await getPosTaxSettings();
      setPosTaxSettings(settings);
      setPosTaxZip(settings.tax_zip || '');
      setPosTaxRate(String(Number(settings.default_tax_rate || 0) * 100));
      setPosTaxSource(settings.tax_source || 'manual');
    } catch (error) {
      console.warn('Failed to load POS tax settings', error);
    }
  }, [accountId, user]);

  useEffect(() => {
    loadPosTaxSettings();
  }, [loadPosTaxSettings]);

  const loadSecurity = useCallback(async () => {
    if (!user || !accountId) return;
    try {
      const [settings, aal, factors] = await Promise.all([
        getAccountSecuritySettings(),
        getAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      setSecuritySettings(settings);
      setCurrentAal(aal);
      setMfaFactors([
        ...((factors.data as any)?.totp || []),
        ...((factors.data as any)?.phone || []),
      ]);
    } catch (error) {
      console.warn('Failed to load security settings', error);
    }
  }, [accountId, user]);

  useEffect(() => {
    loadSecurity();
  }, [loadSecurity]);

  useEffect(() => {
    const thresholds = readAgingThresholds();
    setWatchDaysInput(String(thresholds.watchDays));
    setReviewDaysInput(String(thresholds.reviewDays));
  }, []);

  const handleSaveAgingThreshold = () => {
    const thresholds = normalizeAgingThresholds({
      watchDays: Number(watchDaysInput),
      reviewDays: Number(reviewDaysInput),
    });
    writeAgingThresholds(thresholds);
    setWatchDaysInput(String(thresholds.watchDays));
    setReviewDaysInput(String(thresholds.reviewDays));
    toast.success(`Aging alerts set: watch at ${thresholds.watchDays} days, review at ${thresholds.reviewDays} days`);
  };

  const applyAgingPreset = (watchDays: number, reviewDays: number) => {
    const thresholds = normalizeAgingThresholds({ watchDays, reviewDays });
    setWatchDaysInput(String(thresholds.watchDays));
    setReviewDaysInput(String(thresholds.reviewDays));
    writeAgingThresholds(thresholds);
    toast.success(`Aging preset saved`);
  };

  const handleSaveKey = async (serviceName: string) => {
    if (!user || !accountId || !newKeyValue.trim() || !isAdmin) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('user_api_keys')
        .upsert(
          {
            user_id: accountId,
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

  const saveSecuritySettings = async (updates: Partial<AccountSecuritySettings>) => {
    if (!isAdmin) return;
    try {
      const next = {
        require_mfa: updates.require_mfa ?? securitySettings?.require_mfa ?? false,
        allowed_mfa_methods: updates.allowed_mfa_methods ?? securitySettings?.allowed_mfa_methods ?? ['totp'],
        passkeys_enabled: updates.passkeys_enabled ?? securitySettings?.passkeys_enabled ?? false,
      };
      await upsertAccountSecuritySettings(next);
      toast.success('Security settings saved');
      loadSecurity();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save security settings');
    }
  };

  const lookupPosTaxRate = async () => {
    if (!isAdmin) return;
    const zip = posTaxZip.trim();
    if (!/^\d{5}(?:-\d{4})?$/.test(zip)) {
      toast.error('Enter a valid 5-digit ZIP code');
      return;
    }

    setTaxLookupLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('No active session');

      const response = await fetch('/api/sales-tax-lookup', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ zip }),
      });
      const data = await response.json();
      if (!data?.success) throw new Error(data?.message || 'Sales tax lookup failed');

      setPosTaxRate(String(data.ratePercent));
      setPosTaxSource(data.source || `Sales-Taxes.com ZIP ${zip}`);
      toast.success(`Sales tax set to ${Number(data.ratePercent).toFixed(3)}% for ${zip}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sales tax lookup failed');
    } finally {
      setTaxLookupLoading(false);
    }
  };

  const savePosTaxSettings = async () => {
    if (!isAdmin) return;
    const ratePercent = Math.max(0, Math.min(20, Number(posTaxRate || 0)));
    if (!Number.isFinite(ratePercent)) {
      toast.error('Enter a valid tax rate');
      return;
    }

    try {
      const saved = await upsertPosTaxSettings({
        default_tax_rate: ratePercent / 100,
        tax_zip: posTaxZip.trim(),
        tax_source: posTaxSource.trim() || 'manual',
        tax_lookup_provider: posTaxSource.toLowerCase().includes('sales-taxes.com') ? 'Sales-Taxes.com' : '',
        tax_lookup_enabled: posTaxSource.toLowerCase().includes('sales-taxes.com'),
      });
      setPosTaxSettings(saved);
      toast.success('POS tax settings saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save POS tax settings');
    }
  };

  const beginTotpEnroll = async () => {
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        issuer: 'RetroLootPro',
        friendlyName: 'RetroLootPro app',
      } as any);
      if (error) throw error;
      setTotpFactorId(data.id);
      setTotpQr((data as any).totp?.qr_code || (data as any).totp?.qrCode || '');
      toast.success('Scan the QR code, then enter the 6-digit code.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start authenticator setup');
    }
  };

  const verifyTotpEnroll = async () => {
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId: totpFactorId });
      if (challenge.error) throw challenge.error;
      const verified = await supabase.auth.mfa.verify({
        factorId: totpFactorId,
        challengeId: challenge.data.id,
        code: totpCode.trim(),
      });
      if (verified.error) throw verified.error;
      toast.success('Authenticator app enabled');
      setTotpQr('');
      setTotpFactorId('');
      setTotpCode('');
      loadSecurity();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Verification failed');
    }
  };

  const beginPhoneEnroll = async () => {
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'phone',
        phone: phoneNumber.trim(),
        friendlyName: 'RetroLootPro phone',
      } as any);
      if (error) throw error;
      setPhoneFactorId(data.id);
      toast.success('SMS code sent. Enter it to verify this phone.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start SMS setup. Confirm Phone MFA/SMS is enabled in Supabase.');
    }
  };

  const verifyPhoneEnroll = async () => {
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId: phoneFactorId });
      if (challenge.error) throw challenge.error;
      const verified = await supabase.auth.mfa.verify({
        factorId: phoneFactorId,
        challengeId: challenge.data.id,
        code: phoneCode.trim(),
      });
      if (verified.error) throw verified.error;
      toast.success('SMS MFA enabled');
      setPhoneNumber('');
      setPhoneFactorId('');
      setPhoneCode('');
      loadSecurity();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'SMS verification failed');
    }
  };

  const verifyExistingMfa = async () => {
    const factor = mfaFactors.find((entry) => entry.status === 'verified');
    if (!factor) {
      toast.error('No verified MFA factor found. Enroll one first.');
      return;
    }
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id });
      if (challenge.error) throw challenge.error;
      const verified = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.data.id,
        code: mfaChallengeCode.trim(),
      });
      if (verified.error) throw verified.error;
      toast.success('MFA verified for this session');
      setMfaChallengeCode('');
      loadSecurity();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'MFA verification failed');
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

        {isAdmin && <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-[15px]">Appearance</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose the operating theme for this device. Studio rebuilds the app into a cleaner Apple-style workspace, including the POS.
            </p>
          </div>
          <div className="p-5">
            <ThemeSwitcher />
          </div>
        </div>}

        {isAdmin && <div className="rounded-2xl border border-primary/25 bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-[15px]">POS Sales Tax</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Enter the ZIP used for in-person sales tax. The register uses this saved rate and cannot change it during checkout.
            </p>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div>
                <label className="text-sm font-medium">Sales tax ZIP</label>
                <Input
                  className="mt-1.5 h-11 bg-secondary/40"
                  value={posTaxZip}
                  onChange={(event) => {
                    setPosTaxZip(event.target.value);
                    setPosTaxSource('manual');
                  }}
                  placeholder="Example: 29601"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Sales tax rate %</label>
                <Input
                  className="mt-1.5 h-11 bg-secondary/40"
                  type="number"
                  min="0"
                  max="20"
                  step="0.001"
                  value={posTaxRate}
                  onChange={(event) => {
                    setPosTaxRate(event.target.value);
                    setPosTaxSource('manual');
                  }}
                />
              </div>
              <Button className="h-11" variant="outline" onClick={lookupPosTaxRate} disabled={taxLookupLoading}>
                {taxLookupLoading ? 'Looking Up...' : 'Lookup ZIP'}
              </Button>
            </div>
            <div className="rounded-xl border border-border/30 bg-secondary/20 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current POS Rate</div>
                  <div className="mt-1 text-lg font-semibold text-white/85">{Number(posTaxRate || 0).toFixed(3)}%</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Source</div>
                  <div className="mt-1 text-sm font-semibold text-white/75">{posTaxSource || posTaxSettings?.tax_source || 'manual'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Saved ZIP</div>
                  <div className="mt-1 text-sm font-semibold text-white/75">{posTaxZip || 'Not set'}</div>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                ZIP-only lookup uses public sales-tax data and is a quick register reference. Some jurisdictions need a full address for exact rooftop tax. Use the manual rate if your accountant or state portal gives you a more specific number.
              </p>
            </div>
            <Button className="h-11" onClick={savePosTaxSettings}>
              <Save className="mr-2 h-4 w-4" />
              Save POS Tax
            </Button>
          </div>
        </div>}

        <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-[15px]">Security Controls</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Require MFA, review your current assurance level, and enroll authenticator app or SMS factors.
            </p>
          </div>
          <div className="p-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border/30 bg-secondary/20 p-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current Session</div>
                <div className="text-sm font-semibold text-white/80 mt-1">{currentAal === 'aal2' ? 'MFA verified' : 'Password only'}</div>
              </div>
              <div className="rounded-xl border border-border/30 bg-secondary/20 p-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Account Requirement</div>
                <div className="text-sm font-semibold text-white/80 mt-1">{securitySettings?.require_mfa ? 'MFA required' : 'MFA optional'}</div>
              </div>
              <div className="rounded-xl border border-border/30 bg-secondary/20 p-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Enrolled Factors</div>
                <div className="text-sm font-semibold text-white/80 mt-1">{mfaFactors.filter((f) => f.status === 'verified').length}</div>
              </div>
            </div>

            {isAdmin && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-white/85">Require MFA for the business account</div>
                  <div className="text-xs text-muted-foreground mt-0.5">When enabled, team members must complete MFA before using protected app areas.</div>
                </div>
                <Button
                  variant={securitySettings?.require_mfa ? 'outline' : 'default'}
                  onClick={() => saveSecuritySettings({ require_mfa: !securitySettings?.require_mfa })}
                >
                  {securitySettings?.require_mfa ? 'Disable Requirement' : 'Require MFA'}
                </Button>
              </div>
            )}

            {currentAal !== 'aal2' && mfaFactors.some((factor) => factor.status === 'verified') && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-amber-200">Verify MFA for this session</div>
                  <div className="text-xs text-amber-200/70 mt-0.5">Enter a code from your enrolled factor to unlock protected areas.</div>
                </div>
                <div className="flex gap-2">
                  <Input value={mfaChallengeCode} onChange={(e) => setMfaChallengeCode(e.target.value)} placeholder="6-digit code" className="h-9 w-36 text-xs bg-black/30" />
                  <Button size="sm" onClick={verifyExistingMfa}>Verify</Button>
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-border/30 bg-secondary/20 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-primary" />
                  <div className="text-sm font-semibold text-white/80">Authenticator App</div>
                </div>
                <p className="text-xs text-muted-foreground">Use 1Password, Google Authenticator, Microsoft Authenticator, Authy, or Apple Passwords.</p>
                {!totpQr ? (
                  <Button size="sm" onClick={beginTotpEnroll}>Set Up App MFA</Button>
                ) : (
                  <div className="space-y-2">
                    <img src={totpQr} alt="Authenticator QR code" className="w-36 h-36 rounded-lg bg-white p-2" />
                    <Input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="6-digit code" className="h-9 text-xs bg-black/30" />
                    <Button size="sm" onClick={verifyTotpEnroll}>Verify App</Button>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border/30 bg-secondary/20 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-primary" />
                  <div className="text-sm font-semibold text-white/80">SMS</div>
                </div>
                <p className="text-xs text-muted-foreground">Phone MFA requires SMS/Phone MFA provider configuration in Supabase Auth.</p>
                <Input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+15555555555" className="h-9 text-xs bg-black/30" />
                {!phoneFactorId ? (
                  <Button size="sm" onClick={beginPhoneEnroll}>Send SMS Code</Button>
                ) : (
                  <div className="space-y-2">
                    <Input value={phoneCode} onChange={(e) => setPhoneCode(e.target.value)} placeholder="SMS code" className="h-9 text-xs bg-black/30" />
                    <Button size="sm" onClick={verifyPhoneEnroll}>Verify SMS</Button>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border/30 bg-secondary/20 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-primary" />
                  <div className="text-sm font-semibold text-white/80">Passkey</div>
                </div>
                <p className="text-xs text-muted-foreground">Passkey/WebAuthn is prepared as a security target, but first-class Supabase app auth support is not enabled in this app yet.</p>
                <Badge variant="outline" className="w-fit border-amber-500/25 text-amber-300 bg-amber-500/10">Planned</Badge>
              </div>
            </div>
          </div>
        </div>

        {isAdmin && <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
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
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div>
                <label className="text-sm font-medium">Watch soon</label>
                <div className="mt-1.5 flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={watchDaysInput}
                    onChange={(event) => setWatchDaysInput(event.target.value)}
                    className="h-11 bg-secondary/40"
                  />
                  <span className="text-sm text-muted-foreground">days in stock</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Review now</label>
                <div className="mt-1.5 flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={reviewDaysInput}
                    onChange={(event) => setReviewDaysInput(event.target.value)}
                    className="h-11 bg-secondary/40"
                  />
                  <span className="text-sm text-muted-foreground">days in stock</span>
                </div>
              </div>
              <Button className="h-11" onClick={handleSaveAgingThreshold}>
                <Save className="mr-2 h-4 w-4" />
                Save Alert
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                { label: 'Fast movers', watch: 21, review: 30 },
                { label: 'Standard', watch: 45, review: 60 },
                { label: 'Long tail', watch: 75, review: 90 },
              ].map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => applyAgingPreset(preset.watch, preset.review)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
        </div>}

        {isAdmin && <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
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
        </div>}

        {isAdmin && <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
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
        </div>}

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
