'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, FlaskConical, Loader2, ScanBarcode } from 'lucide-react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { BarcodeScannerView } from '@/components/barcode-scanner-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth-context';
import { closeLabSession, createLabSession, listLabEntries, listLabSessions, scanToLabSession } from '@/lib/scanner-lab';
import { normalizeLabCode, type LabEntry, type LabSession } from '@/lib/scanner-lab-model';
import { toast } from 'sonner';

const money = (value: number | null) => value === null ? 'Not set' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export default function ScannerLabPage() {
  const { user, accountId } = useAuth();
  const userId = user?.id;
  const [sessions, setSessions] = useState<LabSession[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [entries, setEntries] = useState<LabEntry[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastCameraScan = useRef({ code: '', time: 0 });
  const contextKey = `${accountId}:${user?.id}`;
  const contextRef = useRef(contextKey);
  contextRef.current = contextKey;
  const session = sessions.find((item) => item.id === selectedId);

  const reportError = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : 'Scanner Lab request failed.';
    console.error('Scanner Lab:', cause);
    setError(message);
    toast.error(message);
  };

  useEffect(() => {
    let cancelled = false;
    setCamera(false);
    setSessions([]);
    setSelectedId('');
    setEntries([]);
    setError(null);
    setLoadingSessions(false);
    if (!accountId || !userId) return;
    setLoadingSessions(true);
    listLabSessions(accountId, userId).then((items) => {
      if (!cancelled) setSessions(items);
    }).catch((cause: unknown) => {
      if (!cancelled) reportError(cause);
    }).finally(() => {
      if (!cancelled) setLoadingSessions(false);
    });
    return () => { cancelled = true; };
  }, [accountId, userId]);

  useEffect(() => {
    let cancelled = false;
    setCamera(false);
    setEntries([]);
    setLoadingEntries(false);
    lastCameraScan.current = { code: '', time: 0 };
    if (!accountId || !userId || !selectedId) return;
    setLoadingEntries(true);
    listLabEntries(accountId, userId, selectedId).then((items) => {
      if (!cancelled) setEntries(items);
    }).catch((cause: unknown) => {
      if (!cancelled) reportError(cause);
    }).finally(() => {
      if (!cancelled) setLoadingEntries(false);
    });
    return () => { cancelled = true; };
  }, [accountId, userId, selectedId]);

  const runAction = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (contextRef.current === contextKey) reportError(cause);
      setCamera(false);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const startSession = () => runAction(async () => {
    if (!accountId || !user) throw new Error('Sign in to start a session.');
    const created = await createLabSession(accountId, user.id, name);
    if (contextRef.current !== contextKey) return;
    setSessions((current) => [created, ...current]);
    setSelectedId(created.id);
    setName('');
    toast.success('Separate scanner session created');
  });

  const scan = (raw: string, fromCamera = false) => {
    if (busyRef.current) return;
    return runAction(async () => {
      if (!session || !accountId || !user) throw new Error('Select an open session first.');
      const normalized = normalizeLabCode(raw);
      if (fromCamera && lastCameraScan.current.code === normalized && Date.now() - lastCameraScan.current.time < 5000) return;
      const entry = await scanToLabSession(accountId, user.id, session, normalized);
      if (contextRef.current !== contextKey) return;
      lastCameraScan.current = { code: normalized, time: Date.now() };
      setEntries((current) => [entry, ...current]);
      setCode('');
      toast.success(entry.inventory_snapshot.length ? `${entry.inventory_snapshot.length} inventory match(es) saved` : 'No inventory match. Scan saved separately.');
      if (!fromCamera) inputRef.current?.focus();
    });
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-6 p-5 sm:p-8">
        <header>
          <div className="label-caps mb-2 flex items-center gap-2"><FlaskConical className="h-4 w-4" />Experimental</div>
          <h1 className="heading-lg text-2xl">Scanner Lab</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Read your account inventory without changing it. Sessions and scan snapshots are saved separately for your login.
            No items are added, quantities changed, sales recorded, or finance entries created.
          </p>
        </header>

        {error && <div role="alert" className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm">{error}</div>}

        <section aria-label="Scanner sessions" className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Separate sessions</h2>
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); startSession(); }}>
            <div className="flex-1 space-y-2">
              <Label htmlFor="lab-name">New session name</Label>
              <Input id="lab-name" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="For example: Saturday scanner test" disabled={busy || loadingSessions} required />
            </div>
            <Button disabled={busy || loadingSessions} type="submit">Start session</Button>
          </form>
          <div className="space-y-2">
            <Label htmlFor="lab-session">Saved sessions</Label>
            <select id="lab-session" className="w-full rounded-md border border-input bg-background p-3 text-sm" value={selectedId} disabled={busy || loadingSessions} onChange={(event) => { setSelectedId(event.target.value); setError(null); }}>
              <option value="">{loadingSessions ? 'Loading sessions...' : 'Select a session'}</option>
              {sessions.map((item) => <option key={item.id} value={item.id}>{item.name} - {new Date(item.created_at).toLocaleDateString()}{item.closed_at ? ' (closed)' : ' (open)'}</option>)}
            </select>
          </div>
          {session && !session.closed_at && <Button variant="outline" disabled={busy || loadingEntries} onClick={() => runAction(async () => {
            if (!accountId || !user) throw new Error('Sign in to close this session.');
            setCamera(false);
            const closed = await closeLabSession(accountId, user.id, session.id);
            if (contextRef.current !== contextKey) return;
            setSessions((current) => current.map((item) => item.id === closed.id ? closed : item));
            toast.success('Session closed. History remains available.');
          })}>Close session</Button>}
        </section>

        {session && (
          <section aria-label="Scan inventory" className="space-y-4 rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">{session.name}</h2>
            {session.closed_at ? <p className="text-sm text-muted-foreground">Closed session. Start a new session to scan.</p> : <>
              <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); scan(code); }}>
                <div className="flex-1 space-y-2">
                  <Label htmlFor="lab-code">Barcode or SKU</Label>
                  <Input ref={inputRef} id="lab-code" value={code} maxLength={100} onChange={(event) => setCode(event.target.value)} placeholder="Type or use a USB scanner, then press Enter" disabled={busy || loadingEntries} autoComplete="off" required />
                </div>
                <Button type="submit" disabled={busy || loadingEntries}><ScanBarcode className="mr-2 h-4 w-4" />Look up and save scan</Button>
                <Button type="button" variant="outline" disabled={busy || loadingEntries} onClick={() => setCamera(true)}><Camera className="mr-2 h-4 w-4" />Camera</Button>
              </form>
              <p className="text-xs text-muted-foreground">Camera stays on for continuous scanning. Repeat camera reads are ignored for 5 seconds. Multiple matching inventory records are shown, not automatically selected.</p>
            </>}
            <div role="status" aria-live="polite">{busy ? <span className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Saving...</span> : `${entries.length} saved scan(s)`}</div>
            {loadingEntries ? <p role="status">Loading scan history...</p> : entries.length === 0 ? <p className="text-sm text-muted-foreground">No saved scans in this session yet.</p> : (
              <div className="space-y-3">
                {entries.map((entry) => <article key={entry.id} className="space-y-3 rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-sm">{entry.code}</span><time className="text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</time></div>
                  {!entry.inventory_snapshot.length && <p className="text-sm">Not found in inventory. Nothing was added to inventory.</p>}
                  {entry.inventory_snapshot.length > 1 && <p className="text-sm text-amber-400">{entry.inventory_snapshot.length} matches - review each record below.</p>}
                  {entry.inventory_snapshot.map((item) => <div key={item.id} className="rounded-lg bg-secondary/30 p-3">
                    <h3 className="font-semibold">{item.product_name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{item.console || 'No platform'} / {item.condition || 'No condition'} / {item.status || 'No status'}</p>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <div><dt className="text-muted-foreground">Quantity</dt><dd>{item.quantity ?? 'Not set'}</dd></div>
                      <div><dt className="text-muted-foreground">Cost</dt><dd>{money(item.purchase_price)}</dd></div>
                      <div><dt className="text-muted-foreground">Sale price</dt><dd>{money(item.sell_price)}</dd></div>
                      <div><dt className="text-muted-foreground">SKU</dt><dd className="break-all">{item.sku || 'Not set'}</dd></div>
                    </dl>
                  </div>)}
                </article>)}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Inventory details are snapshots taken at scan time, not live quantities. Scan again to capture current data.</p>
          </section>
        )}
        {camera && <BarcodeScannerView isActive={camera} onScan={(result) => { scan(result.barcode, true); }} onStop={() => setCamera(false)} title="Scanner Lab - continuous inventory lookup" />}
      </div>
    </DashboardLayout>
  );
}
