'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Package2, CircleCheck as CheckCircle, ExternalLink, Unplug, Plug } from 'lucide-react';
import { toast } from 'sonner';

const MARKETPLACES = [
  { id: 'ATVPDKIKX0DER', label: 'United States' },
  { id: 'A2EUQ1WTGCTBG2', label: 'Canada' },
  { id: 'A1AM78C64UM0Y8', label: 'Mexico' },
  { id: 'A1RKKUPIHCS866', label: 'Spain' },
  { id: 'A1F83G8C2ARO7P', label: 'United Kingdom' },
  { id: 'A13V1IB3VIYZZH', label: 'France' },
  { id: 'A1PA6795UKMFR9', label: 'Germany' },
  { id: 'APJ6JRA9NG5V4', label: 'Italy' },
];

type CredentialForm = {
  app_id: string;
  lwa_client_id: string;
  lwa_client_secret: string;
  aws_access_key: string;
  aws_secret_key: string;
  marketplace_id: string;
};

type ConnectionStatus = { connected: boolean; account_name?: string; connected_at?: string };

export function AmazonConnectCard({ onStatusChange }: { onStatusChange?: (connected: boolean) => void }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [form, setForm] = useState<CredentialForm>({
    app_id: '',
    lwa_client_id: '',
    lwa_client_secret: '',
    aws_access_key: '',
    aws_secret_key: '',
    marketplace_id: 'ATVPDKIKX0DER',
  });

  const loadStatus = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.functions.invoke('amazon-auth', { body: { action: 'status' } });
      if (!error && data) { setStatus(data); onStatusChange?.(data.connected); }
    } catch { setStatus({ connected: false }); }
    finally { setLoading(false); }
  }, [user, onStatusChange]);

  const loadCredentials = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('user_api_keys')
      .select('provider, api_key')
      .eq('user_id', user.id)
      .in('provider', ['amazon_app_id', 'amazon_lwa_client_id', 'amazon_lwa_client_secret', 'amazon_aws_access_key', 'amazon_aws_secret_key', 'amazon_marketplace_id']);
    const keys: Record<string, string> = {};
    for (const k of (data || [])) keys[k.provider] = k.api_key;
    setForm(f => ({
      ...f,
      app_id: keys['amazon_app_id'] || '',
      lwa_client_id: keys['amazon_lwa_client_id'] || '',
      lwa_client_secret: keys['amazon_lwa_client_secret'] || '',
      aws_access_key: keys['amazon_aws_access_key'] || '',
      aws_secret_key: keys['amazon_aws_secret_key'] || '',
      marketplace_id: keys['amazon_marketplace_id'] || 'ATVPDKIKX0DER',
    }));
  }, [user]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleShowForm = async () => { await loadCredentials(); setShowForm(true); };

  const handleSaveAndConnect = async () => {
    if (!user) return;
    const required = [form.app_id, form.lwa_client_id, form.lwa_client_secret, form.aws_access_key, form.aws_secret_key];
    if (required.some(v => !v.trim())) return;
    setSavingCreds(true);
    try {
      const upserts = [
        { user_id: user.id, provider: 'amazon_app_id', api_key: form.app_id.trim(), status: 'active', updated_at: new Date().toISOString() },
        { user_id: user.id, provider: 'amazon_lwa_client_id', api_key: form.lwa_client_id.trim(), status: 'active', updated_at: new Date().toISOString() },
        { user_id: user.id, provider: 'amazon_lwa_client_secret', api_key: form.lwa_client_secret.trim(), status: 'active', updated_at: new Date().toISOString() },
        { user_id: user.id, provider: 'amazon_aws_access_key', api_key: form.aws_access_key.trim(), status: 'active', updated_at: new Date().toISOString() },
        { user_id: user.id, provider: 'amazon_aws_secret_key', api_key: form.aws_secret_key.trim(), status: 'active', updated_at: new Date().toISOString() },
        { user_id: user.id, provider: 'amazon_marketplace_id', api_key: form.marketplace_id, status: 'active', updated_at: new Date().toISOString() },
      ];
      for (const upsert of upserts) {
        await supabase.from('user_api_keys').upsert(upsert, { onConflict: 'user_id,provider' });
      }
      const redirectUri = `${window.location.origin}/auth/amazon/callback`;
      const authUrl = new URL('https://sellercentral.amazon.com/apps/authorize/consent');
      authUrl.searchParams.set('application_id', form.app_id.trim());
      authUrl.searchParams.set('state', btoa(redirectUri));
      authUrl.searchParams.set('redirect_uri', redirectUri);
      window.location.href = authUrl.toString();
    } catch {
      toast.error('Failed to save Amazon credentials');
    } finally {
      setSavingCreds(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('amazon-auth', { body: { action: 'disconnect' } });
      if (error || data?.error) throw new Error(data?.error || 'Failed to disconnect');
      toast.success('Amazon account disconnected');
      setStatus({ connected: false });
      setShowForm(false);
      onStatusChange?.(false);
    } catch { toast.error('Failed to disconnect Amazon account'); }
    finally { setDisconnecting(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-3">
        <div className="w-8 h-8 rounded-lg bg-secondary animate-pulse" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-24 bg-secondary rounded animate-pulse" />
          <div className="h-2.5 w-40 bg-secondary/60 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <Package2 className="w-4 h-4 text-amber-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">Amazon</span>
              {status?.connected ? (
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                  <CheckCircle className="w-2.5 h-2.5 mr-1" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] border-border/50 text-muted-foreground">
                  Not Connected
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {status?.connected
                ? 'Sync unshipped orders from Amazon Seller Central via SP-API'
                : 'Connect via Amazon SP-API to pull unshipped orders into the Shipping Hub'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status?.connected ? (
            <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-destructive"
              onClick={handleDisconnect} disabled={disconnecting}>
              <Unplug className="w-3.5 h-3.5 mr-1.5" />
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleShowForm}>
              <Plug className="w-3.5 h-3.5 mr-1.5" />
              Connect
            </Button>
          )}
        </div>
      </div>

      {showForm && !status?.connected && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
          <div className="text-xs text-muted-foreground leading-relaxed">
            Set up an SP-API app in{' '}
            <a href="https://sellercentral.amazon.com/sellingpartner/developerconsole" target="_blank" rel="noopener noreferrer"
              className="text-amber-400 hover:underline inline-flex items-center gap-0.5">
              Seller Central Developer Console <ExternalLink className="w-2.5 h-2.5" />
            </a>
            {' '}and create an IAM user with SP-API permissions. Register{' '}
            <code className="text-[11px] bg-secondary/60 px-1 py-0.5 rounded">
              {typeof window !== 'undefined' ? window.location.origin : ''}/auth/amazon/callback
            </code>{' '}as your redirect URL.
          </div>

          <div className="grid gap-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">App ID</Label>
                <Input value={form.app_id} onChange={e => setForm(f => ({ ...f, app_id: e.target.value }))}
                  placeholder="amzn1.sellerapps.app.xxx" className="h-8 text-xs font-mono bg-secondary/40 border-border/60" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Marketplace</Label>
                <Select value={form.marketplace_id} onValueChange={v => setForm(f => ({ ...f, marketplace_id: v }))}>
                  <SelectTrigger className="h-8 text-xs bg-secondary/40 border-border/60">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKETPLACES.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-white/50">LWA Client ID</Label>
              <Input value={form.lwa_client_id} onChange={e => setForm(f => ({ ...f, lwa_client_id: e.target.value }))}
                placeholder="amzn1.application-oa2-client.xxx" className="h-8 text-xs font-mono bg-secondary/40 border-border/60" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-white/50">LWA Client Secret</Label>
              <Input type="password" value={form.lwa_client_secret} onChange={e => setForm(f => ({ ...f, lwa_client_secret: e.target.value }))}
                placeholder="Client secret from developer console" className="h-8 text-xs font-mono bg-secondary/40 border-border/60" />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">AWS Access Key ID</Label>
                <Input value={form.aws_access_key} onChange={e => setForm(f => ({ ...f, aws_access_key: e.target.value }))}
                  placeholder="AKIAIOSFODNN7EXAMPLE" className="h-8 text-xs font-mono bg-secondary/40 border-border/60" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">AWS Secret Access Key</Label>
                <Input type="password" value={form.aws_secret_key} onChange={e => setForm(f => ({ ...f, aws_secret_key: e.target.value }))}
                  placeholder="wJalrXUtnFEMI/K7MDENG" className="h-8 text-xs font-mono bg-secondary/40 border-border/60" />
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs bg-amber-500 hover:bg-amber-600 text-white"
              onClick={handleSaveAndConnect}
              disabled={savingCreds || !form.app_id.trim() || !form.lwa_client_id.trim() || !form.lwa_client_secret.trim() || !form.aws_access_key.trim() || !form.aws_secret_key.trim()}>
              <ExternalLink className="w-3 h-3 mr-1.5" />
              {savingCreds ? 'Saving...' : 'Authorize with Amazon'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
