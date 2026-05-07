'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Building2, Plus, RefreshCw, Trash2, CircleCheck as CheckCircle2, CircleAlert as AlertCircle, ExternalLink, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { getBankConnections, deleteBankConnection, syncBankTransactions, formatCurrency, type BankConnection } from '@/lib/finance-services';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import { format } from 'date-fns';

declare global {
  interface Window {
    Plaid?: {
      create: (config: PlaidConfig) => { open: () => void; destroy: () => void };
    };
  }
}

type PlaidConfig = {
  token: string;
  onSuccess: (publicToken: string, metadata: unknown) => void;
  onExit: (err: unknown) => void;
  onLoad?: () => void;
};

const DRAFT_KEY = 'plaid_draft';

function PlaidSetupCard({ onSaved }: { onSaved: () => void }) {
  const { user, accountId } = useAuth();
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [env, setEnv] = useState('sandbox');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('user_api_keys')
        .select('provider, api_key')
        .eq('user_id', (accountId || user.id))
        .in('provider', ['plaid_client_id', 'plaid_secret', 'plaid_env']);
      const kv: Record<string, string> = {};
      for (const k of (data || [])) kv[k.provider] = k.api_key;

      try {
        const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
        setClientId(draft.clientId ?? kv['plaid_client_id'] ?? '');
        setSecret(draft.secret ?? kv['plaid_secret'] ?? '');
        setEnv(draft.env ?? kv['plaid_env'] ?? 'sandbox');
      } catch {
        setClientId(kv['plaid_client_id'] || '');
        setSecret(kv['plaid_secret'] || '');
        setEnv(kv['plaid_env'] || 'sandbox');
      }
      setLoading(false);
    })();
  }, [user]);

  const updateClientId = (v: string) => {
    setClientId(v);
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ clientId: v, secret, env })); } catch {}
  };
  const updateSecret = (v: string) => {
    setSecret(v);
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ clientId, secret: v, env })); } catch {}
  };
  const updateEnv = (v: string) => {
    setEnv(v);
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ clientId, secret, env: v })); } catch {}
  };

  const handleSave = async () => {
    if (!user || !clientId.trim() || !secret.trim()) return;
    setSaving(true);
    try {
      await supabase.from('user_api_keys').upsert([
        { user_id: (accountId || user.id), provider: 'plaid_client_id', api_key: clientId.trim(), status: 'active', updated_at: new Date().toISOString() },
        { user_id: (accountId || user.id), provider: 'plaid_secret', api_key: secret.trim(), status: 'active', updated_at: new Date().toISOString() },
        { user_id: (accountId || user.id), provider: 'plaid_env', api_key: env, status: 'active', updated_at: new Date().toISOString() },
      ], { onConflict: 'user_id,provider' });
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      toast.success('Plaid credentials saved');
      onSaved();
    } catch { toast.error('Failed to save credentials'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="rounded-2xl border border-border/40 bg-card h-48 animate-pulse" />;

  return (
    <div className="rounded-2xl border border-border/40 bg-card p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-sky-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white/80">Connect Bank Accounts via Plaid</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Plaid securely connects to 12,000+ financial institutions to pull in transactions for reconciliation. Create a free account at{' '}
            <a href="https://dashboard.plaid.com/signup" target="_blank" rel="noopener noreferrer"
              className="text-sky-400 hover:underline inline-flex items-center gap-0.5">
              plaid.com <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="sm:col-span-1 space-y-1">
          <Label className="text-[11px] text-white/50">Environment</Label>
          <select
            value={env}
            onChange={e => updateEnv(e.target.value)}
            className="w-full h-8 text-xs rounded-md border border-border/60 bg-secondary/40 text-white/80 px-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="sandbox">Sandbox (Test)</option>
            <option value="development">Development</option>
            <option value="production">Production</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-white/50">Client ID</Label>
          <Input value={clientId} onChange={e => updateClientId(e.target.value)}
            placeholder="Plaid client_id" className="h-8 text-xs font-mono bg-secondary/40 border-border/60" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-white/50">Secret</Label>
          <Input type="password" value={secret} onChange={e => updateSecret(e.target.value)}
            placeholder="Plaid secret key" className="h-8 text-xs font-mono bg-secondary/40 border-border/60" />
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={saving || !clientId.trim() || !secret.trim()}>
          {saving ? 'Saving...' : 'Save Credentials'}
        </Button>
      </div>
    </div>
  );
}

function BankConnectionCard({ connection, onSync, onDelete }: {
  connection: BankConnection;
  onSync: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try { await onSync(connection.id); }
    finally { setSyncing(false); }
  };

  const handleDelete = async () => {
    if (!confirm(`Disconnect ${connection.institution_name || 'this bank'}? Bank transactions already imported will remain.`)) return;
    setDeleting(true);
    try { await onDelete(connection.id); }
    finally { setDeleting(false); }
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-white/80">{connection.institution_name || 'Bank Account'}</span>
              <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                <Wifi className="w-2 h-2 mr-1" />
                Connected
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {connection.account_names?.length > 0
                ? connection.account_names.join(', ')
                : `${connection.account_ids?.length || 0} account(s)`}
            </div>
            {connection.last_synced_at && (
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Last synced {format(new Date(connection.last_synced_at), 'MMM d, yyyy h:mm a')}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync'}
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-destructive" onClick={handleDelete} disabled={deleting}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function BanksTab() {
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [credsSaved, setCredsSaved] = useState(false);
  const plaidHandlerRef = useRef<{ open: () => void; destroy: () => void } | null>(null);

  const load = useCallback(async () => {
    try {
      const [connectionsData, keysData] = await Promise.all([
        getBankConnections(),
        supabase.from('user_api_keys').select('provider').in('provider', ['plaid_client_id', 'plaid_secret']),
      ]);
      setConnections(connectionsData);
      const savedKeys = (keysData.data || []).map((k: { provider: string }) => k.provider);
      if (savedKeys.includes('plaid_client_id') && savedKeys.includes('plaid_secret')) {
        setCredsSaved(true);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadPlaidScript = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (window.Plaid) { resolve(); return; }
      const script = document.createElement('script');
      script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
      script.onload = () => resolve();
      document.head.appendChild(script);
    });
  }, []);

  const invokeFn = async (fn: string, body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const handleAddBank = async () => {
    setLinking(true);
    try {
      const data = await invokeFn('plaid-link-token', {});

      await loadPlaidScript();
      if (!window.Plaid) throw new Error('Plaid Link failed to load');

      plaidHandlerRef.current = window.Plaid.create({
        token: data.link_token,
        onSuccess: async (publicToken) => {
          try {
            const exchangeData = await invokeFn('plaid-exchange-token', { public_token: publicToken });
            toast.success(`${exchangeData.institution_name || 'Bank'} connected successfully`);
            setCredsSaved(true);
            load();
            try {
              const syncData = await invokeFn('plaid-sync-transactions', {});
              if (syncData?.added > 0) toast.success(`Imported ${syncData.added} transactions`);
            } catch { /* silent — bank is connected, sync can retry */ }
          } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : 'Failed to connect bank');
          }
          setLinking(false);
        },
        onExit: () => { setLinking(false); },
      });
      plaidHandlerRef.current.open();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to open Plaid Link');
      setLinking(false);
    }
  };

  const handleSync = async (id: string) => {
    try {
      const result = await syncBankTransactions(id);
      toast.success(`Synced: ${result.added} new, ${result.modified} updated, ${result.removed} removed`);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Sync failed');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBankConnection(id);
      toast.success('Bank account disconnected');
      load();
    } catch { toast.error('Failed to disconnect'); }
  };

  if (loading) {
    return <div className="space-y-4">{[...Array(2)].map((_, i) => <div key={i} className="rounded-2xl border border-border/40 bg-card h-32 animate-pulse" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <PlaidSetupCard onSaved={() => setCredsSaved(true)} />

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/70">Connected Accounts ({connections.length})</h3>
        <Button size="sm" className="h-8 text-xs bg-sky-500 hover:bg-sky-600 text-white" onClick={handleAddBank} disabled={linking || !credsSaved}>
          {linking ? (
            <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Connecting...</>
          ) : (
            <><Plus className="w-3.5 h-3.5 mr-1.5" />Connect Bank</>
          )}
        </Button>
      </div>

      {connections.length === 0 ? (
        <div className="rounded-2xl border border-border/30 bg-secondary/10 p-10 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mx-auto">
            <Building2 className="w-6 h-6 text-sky-400/60" />
          </div>
          <div>
            <div className="text-sm font-medium text-white/50">No bank accounts connected</div>
            <div className="text-xs text-muted-foreground mt-1">Enter your Plaid credentials above, then click "Connect Bank" to link your accounts.</div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {connections.map(conn => (
            <BankConnectionCard key={conn.id} connection={conn} onSync={handleSync} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-border/40 bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white/80">About Bank Reconciliation</h3>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { icon: Building2, color: 'sky', title: 'Connect', desc: 'Plaid connects to 12,000+ banks and credit unions securely using bank-level encryption.' },
            { icon: RefreshCw, color: 'emerald', title: 'Sync', desc: 'Transactions are pulled incrementally. New transactions appear in the Transactions tab automatically.' },
            { icon: CheckCircle2, color: 'primary', title: 'Reconcile', desc: 'Match bank transactions to your sales records. Check the circle icon on any transaction to mark it reconciled.' },
          ].map(({ icon: Icon, color, title, desc }) => (
            <div key={title} className="flex gap-3">
              <div className={`w-8 h-8 rounded-lg bg-${color}-500/10 border border-${color}-500/20 flex items-center justify-center shrink-0`}
                style={{ backgroundColor: `var(--${color}-10, rgba(14,165,233,0.1))`, borderColor: `var(--${color}-20, rgba(14,165,233,0.2))` }}>
                <Icon className="w-4 h-4 text-sky-400" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white/70">{title}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-200/70 leading-relaxed">
            <strong className="text-amber-200/90">Plaid Sandbox</strong> uses test credentials only (username: <code className="bg-black/30 px-1 rounded">user_good</code>, password: <code className="bg-black/30 px-1 rounded">pass_good</code>). Switch to <strong className="text-amber-200/90">Development</strong> or <strong className="text-amber-200/90">Production</strong> to connect real bank accounts.
          </p>
        </div>
      </div>
    </div>
  );
}
