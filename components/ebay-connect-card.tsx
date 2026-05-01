'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { ShoppingBag, CircleCheck as CheckCircle, CircleAlert as AlertCircle, ExternalLink, Unplug, Plug } from 'lucide-react';
import { toast } from 'sonner';

const EBAY_SCOPES = 'https://api.ebay.com/oauth/api_scope/sell.fulfillment';

type ConnectionStatus = {
  connected: boolean;
  account_name?: string;
  connected_at?: string;
};

type CredentialForm = {
  client_id: string;
  client_secret: string;
  runame: string;
};

export function EbayConnectCard({ onStatusChange }: { onStatusChange?: (connected: boolean) => void }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [form, setForm] = useState<CredentialForm>({ client_id: '', client_secret: '', runame: '' });
  const [savingCreds, setSavingCreds] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.functions.invoke('ebay-auth', {
        body: { action: 'status' },
      });
      if (!error && data) {
        setStatus(data);
        onStatusChange?.(data.connected);
      }
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, [user, onStatusChange]);

  const loadCredentials = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('user_api_keys')
      .select('provider, api_key')
      .eq('user_id', user.id)
      .in('provider', ['ebay_client_id', 'ebay_client_secret', 'ebay_runame']);

    const keys: Record<string, string> = {};
    for (const k of (data || [])) keys[k.provider] = k.api_key;
    setForm({
      client_id: keys['ebay_client_id'] || '',
      client_secret: keys['ebay_client_secret'] || '',
      runame: keys['ebay_runame'] || '',
    });
  }, [user]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleShowForm = async () => {
    await loadCredentials();
    setShowForm(true);
  };

  const handleSaveAndConnect = async () => {
    if (!user || !form.client_id.trim() || !form.client_secret.trim() || !form.runame.trim()) return;
    setSavingCreds(true);
    try {
      const upserts = [
        { user_id: user.id, provider: 'ebay_client_id', api_key: form.client_id.trim(), status: 'active', updated_at: new Date().toISOString() },
        { user_id: user.id, provider: 'ebay_client_secret', api_key: form.client_secret.trim(), status: 'active', updated_at: new Date().toISOString() },
        { user_id: user.id, provider: 'ebay_runame', api_key: form.runame.trim(), status: 'active', updated_at: new Date().toISOString() },
      ];

      for (const upsert of upserts) {
        await supabase.from('user_api_keys').upsert(upsert, { onConflict: 'user_id,provider' });
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('ebay_runame', form.runame.trim());
      }

      const callbackUrl = `${window.location.origin}/auth/ebay/callback`;
      const authUrl = new URL('https://auth.ebay.com/oauth2/authorize');
      authUrl.searchParams.set('client_id', form.client_id.trim());
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', form.runame.trim());
      authUrl.searchParams.set('scope', EBAY_SCOPES);
      authUrl.searchParams.set('state', btoa(callbackUrl));

      window.location.href = authUrl.toString();
    } catch {
      toast.error('Failed to save eBay credentials');
    } finally {
      setSavingCreds(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('ebay-auth', {
        body: { action: 'disconnect' },
      });
      if (error || data?.error) throw new Error(data?.error || 'Failed to disconnect');
      toast.success('eBay account disconnected');
      setStatus({ connected: false });
      setShowForm(false);
      onStatusChange?.(false);
    } catch {
      toast.error('Failed to disconnect eBay account');
    } finally {
      setDisconnecting(false);
    }
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
          <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-4 h-4 text-orange-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">eBay</span>
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
                ? `Sync awaiting-shipment orders from your eBay seller account`
                : 'Connect to pull orders awaiting shipment into the Shipping Hub'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {status?.connected ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground hover:text-destructive"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              <Unplug className="w-3.5 h-3.5 mr-1.5" />
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={handleShowForm}
            >
              <Plug className="w-3.5 h-3.5 mr-1.5" />
              Connect
            </Button>
          )}
        </div>
      </div>

      {showForm && !status?.connected && (
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 space-y-3">
          <div className="text-xs text-muted-foreground leading-relaxed">
            Enter your eBay Developer App credentials. You can find these in the{' '}
            <a
              href="https://developer.ebay.com/my/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 hover:underline inline-flex items-center gap-0.5"
            >
              eBay Developer Portal
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
            . Register <code className="text-[11px] bg-secondary/60 px-1 py-0.5 rounded">{typeof window !== 'undefined' ? window.location.origin : ''}/auth/ebay/callback</code> as your redirect URL.
          </div>

          <div className="grid gap-2.5">
            <div className="space-y-1">
              <Label className="text-[11px] text-white/50">App ID (Client ID)</Label>
              <Input
                value={form.client_id}
                onChange={(e) => setForm(f => ({ ...f, client_id: e.target.value }))}
                placeholder="e.g. MyApp-12345-PRD-xxxxxxxx"
                className="h-8 text-xs font-mono bg-secondary/40 border-border/60"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-white/50">Cert ID (Client Secret)</Label>
              <Input
                type="password"
                value={form.client_secret}
                onChange={(e) => setForm(f => ({ ...f, client_secret: e.target.value }))}
                placeholder="PRD-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="h-8 text-xs font-mono bg-secondary/40 border-border/60"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-white/50">RuName (Redirect URL Name)</Label>
              <Input
                value={form.runame}
                onChange={(e) => setForm(f => ({ ...f, runame: e.target.value }))}
                placeholder="e.g. MyApp-AppName-PRD-xxxxxxxx"
                className="h-8 text-xs font-mono bg-secondary/40 border-border/60"
              />
              <p className="text-[10px] text-muted-foreground/60">Found in the eBay Developer Portal under your app's redirect URLs</p>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs bg-orange-500 hover:bg-orange-600 text-white"
              onClick={handleSaveAndConnect}
              disabled={savingCreds || !form.client_id.trim() || !form.client_secret.trim() || !form.runame.trim()}
            >
              <ExternalLink className="w-3 h-3 mr-1.5" />
              {savingCreds ? 'Saving...' : 'Authorize with eBay'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
