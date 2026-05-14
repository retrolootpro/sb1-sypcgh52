'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, FileLock2, FileText, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import {
  deleteBusinessDocument,
  downloadEncryptedBusinessDocument,
  listBusinessDocuments,
  uploadEncryptedBusinessDocument,
  type BusinessDocument,
} from '@/lib/document-vault';
import { format } from 'date-fns';
import { toast } from 'sonner';

const DOCUMENT_TYPES = ['EIN', 'LLC', 'Sales Certificate', 'Reseller Permit', 'Insurance', 'Tax', 'Banking', 'Contract', 'Other'];

export default function DocumentsPage() {
  const { isAdmin } = useAuth();
  const [docs, setDocs] = useState<BusinessDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    title: '',
    documentType: 'EIN',
    visibility: 'team',
    notes: '',
  });
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDocs(await listBusinessDocuments());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async () => {
    if (!file) {
      toast.error('Choose a document to upload.');
      return;
    }
    if (!form.title.trim()) {
      toast.error('Add a clear document title.');
      return;
    }
    setUploading(true);
    try {
      await uploadEncryptedBusinessDocument({
        file,
        title: form.title,
        documentType: form.documentType,
        visibility: form.visibility as 'team' | 'admin',
        notes: form.notes,
        passphrase,
      });
      toast.success('Document encrypted and uploaded');
      setFile(null);
      setForm({ title: '', documentType: 'EIN', visibility: 'team', notes: '' });
      setShowUpload(false);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc: BusinessDocument) => {
    try {
      const blob = await downloadEncryptedBusinessDocument(doc, passphrase);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.original_file_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Download failed');
    }
  };

  const handleDelete = async (doc: BusinessDocument) => {
    if (!window.confirm(`Delete ${doc.title}? This cannot be undone.`)) return;
    try {
      await deleteBusinessDocument(doc);
      toast.success('Document deleted');
      setDocs((rows) => rows.filter((row) => row.id !== doc.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Delete failed');
    }
  };

  return (
    <DashboardLayout>
      <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="label-caps mb-1">Secure Records</div>
            <h1 className="heading-xl text-white/90">Business Document Vault</h1>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              Store EIN, LLC, sales certificate, reseller permits, insurance, and other important business documents. Files are encrypted in your browser before upload and stored in a private RLS-protected bucket.
            </p>
          </div>
          <Button onClick={() => setShowUpload((value) => !value)} className="h-9 text-xs">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Upload Document
          </Button>
        </div>

        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-3">
              <KeyRound className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-white/85">Vault Passphrase</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  This passphrase is never stored. You need it to encrypt uploads and decrypt downloads. Keep it in your password manager.
                </p>
              </div>
            </div>
            <Input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="Enter vault passphrase"
              className="h-10 text-sm bg-black/30 lg:max-w-sm"
            />
          </div>
        </div>

        {showUpload && (
          <div className="rounded-2xl border border-border/40 bg-card p-5 space-y-4">
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1 lg:col-span-2">
                <Label className="text-[11px] text-white/50">Document Title</Label>
                <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="RetroLootPro EIN Letter" className="h-9 text-xs bg-secondary/40" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Type</Label>
                <Select value={form.documentType} onValueChange={(value) => setForm((f) => ({ ...f, documentType: value }))}>
                  <SelectTrigger className="h-9 text-xs bg-secondary/40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Visibility</Label>
                <Select value={form.visibility} onValueChange={(value) => setForm((f) => ({ ...f, visibility: value }))}>
                  <SelectTrigger className="h-9 text-xs bg-secondary/40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team">Team</SelectItem>
                    {isAdmin && <SelectItem value="admin">Admin Only</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">File</Label>
                <Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="h-9 text-xs bg-secondary/40" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Where this is used, renewal notes, permit number..." className="min-h-20 text-xs bg-secondary/40" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowUpload(false)}>Cancel</Button>
              <Button size="sm" onClick={handleUpload} disabled={uploading}>{uploading ? 'Encrypting...' : 'Encrypt & Upload'}</Button>
            </div>
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-border/40 bg-card p-4">
            <ShieldCheck className="w-5 h-5 text-primary mb-2" />
            <div className="text-sm font-semibold text-white/80">Client-Side Encryption</div>
            <div className="text-xs text-muted-foreground mt-1">AES-GCM encryption happens before the file leaves your browser.</div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-card p-4">
            <FileLock2 className="w-5 h-5 text-primary mb-2" />
            <div className="text-sm font-semibold text-white/80">Private Storage</div>
            <div className="text-xs text-muted-foreground mt-1">Supabase Storage bucket is private and RLS-limited to the account.</div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-card p-4">
            <KeyRound className="w-5 h-5 text-primary mb-2" />
            <div className="text-sm font-semibold text-white/80">No Stored Passphrase</div>
            <div className="text-xs text-muted-foreground mt-1">If the passphrase is lost, the encrypted files cannot be recovered.</div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
          {loading ? (
            <div className="p-5 space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />)}
            </div>
          ) : docs.length === 0 ? (
            <div className="py-14 text-center space-y-3">
              <FileText className="w-10 h-10 text-white/10 mx-auto" />
              <div>
                <div className="text-sm font-semibold text-white/75">No secure documents yet</div>
                <div className="text-xs text-muted-foreground mt-1">Upload EIN, LLC, sales certificate, reseller permit, and insurance records here.</div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {docs.map((doc) => (
                <div key={doc.id} className="p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between hover:bg-secondary/15">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileLock2 className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold text-white/85 truncate">{doc.title}</span>
                      <Badge variant="outline" className="text-[10px] border-primary/25 text-primary bg-primary/10">{doc.document_type}</Badge>
                      <Badge variant="outline" className="text-[10px] border-white/10 text-white/45">{doc.visibility === 'admin' ? 'Admin Only' : 'Team'}</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {doc.original_file_name} · uploaded {format(new Date(doc.created_at), 'MMM d, yyyy')}
                    </div>
                    {doc.notes && <div className="text-[11px] text-white/45 mt-1 line-clamp-2">{doc.notes}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleDownload(doc)}>
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      Decrypt
                    </Button>
                    {isAdmin && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-white/35 hover:text-red-300" onClick={() => handleDelete(doc)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
