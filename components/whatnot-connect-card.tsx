'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Tv, CircleCheck as CheckCircle, ExternalLink, Unplug, Plug } from 'lucide-react';
import { toast } from 'sonner';

type ConnectionStatus = { connected: boolean; account_name?: string; connected_at?: string };

export function WhatnotConnectCard({ onStatusChange }: { onStatusChange?: (connected: boolean) => void }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const loadStatus = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.functions.invoke('whatnot-auth', { body: { action: 'status' } });
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
      .in('provider', ['whatnot_client_id', 'whatnot_client_secret']);
    const keys: Record<string, string> = {};
    for (const k of (data || [])) keys[k.provider] = k.api_key;
    setClientId(keys['whatnot_client_id'] || '');
    setClientSecret(keys['whatnot_client_secret'] || '');
  }, [user]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleShowForm = async () => { await loadCredentials(); setShowForm(true); };

  const handleConnect = async () => {
    if (!user || !clientId.trim() || !clientSecret.trim()) return;
    setSaving(true);
    try {
      await supabase.from('user_api_keys').upsert([
        { user_id: user.id, provider: 'whatnot_client_id', api_key: clientId.trim(), status: 'active', updated_at: new Date().toISOString() },
        { user_id: user.id, provider: 'whatnot_client_secret', api_key: clientSecret.trim(), status: 'active', updated_at: new Date().toISOString() },
      ], { onConflict: 'user_id,provider' });

      const redirectUri = `${window.location.origin}/auth/whatnot/callback`;
      const authUrl = new URL('https://api.whatnot.com/seller-api/rest/oauth/authorize');
      authUrl.searchParams.set('client_id', clientId.trim());
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'read:orders read:customers');
      window.location.href = authUrl.toString();
    } catch {
      toast.error('Failed to save Whatnot credentials');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('whatnot-auth', { body: { action: 'disconnect' } });
      if (error || data?.error) throw new Error(data?.error || 'Failed to disconnect');
      toast.success('Whatnot account disconnected');
      setStatus({ connected: false });
      setShowForm(false);
      onStatusChange?.(false);
    } catch { toast.error('Failed to disconnect Whatnot account'); }
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
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
            <Tv className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">Whatnot</span>
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
                ? 'Sync orders from your Whatnot seller account via the Seller API'
                : 'Connect via Whatnot Seller API OAuth to pull orders into the Shipping Hub'}
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
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-3">
          <div className="text-xs text-muted-foreground leading-relaxed">
            Apply for Seller API access at{' '}
            <a href="https://developers.whatnot.com" target="_blank" rel="noopener noreferrer"
              className="text-cyan-400 hover:underline inline-flex items-center gap-0.5">
              developers.whatnot.com <ExternalLink className="w-2.5 h-2.5" />
            </a>
            . Once approved, register{' '}
            <code className="text-[11px] bg-secondary/60 px-1 py-0.5 rounded">
              {typeof window !== 'undefined' ? window.location.origin : ''}/auth/whatnot/callback
            </code>{' '}as your redirect URI.
          </div>

          <div className="grid gap-2.5">
            <div className="space-y-1">
              <Label className="text-[11px] text-white/50">Client ID</Label>
              <Input value={clientId} onChange={e => setClientId(e.target.value)}
                placeholder="Your Whatnot app client ID"
                className="h-8 text-xs font-mono bg-secondary/40 border-border/60" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-white/50">Client Secret</Label>
              <Input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)}
                placeholder="Your Whatnot app client secret"
                className="h-8 text-xs font-mono bg-secondary/40 border-border/60" />
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs bg-cyan-500 hover:bg-cyan-600 text-white"
              onClick={handleConnect}
              disabled={saving || !clientId.trim() || !clientSecret.trim()}>
              <ExternalLink className="w-3 h-3 mr-1.5" />
              {saving ? 'Saving...' : 'Authorize with Whatnot'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
