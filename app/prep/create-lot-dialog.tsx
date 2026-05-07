'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (lotId: string, lotName: string) => void;
};

export function CreateLotDialog({ open, onOpenChange, onSuccess }: Props) {
  const { user, accountId } = useAuth();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', source: '', notes: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !user || !accountId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('lots')
        .insert({ user_id: accountId, name: form.name.trim(), source: form.source.trim(), notes: form.notes.trim() })
        .select()
        .single();
      if (error) throw error;
      toast.success(`Lot "${form.name}" created`);
      setForm({ name: '', source: '', notes: '' });
      onOpenChange(false);
      onSuccess(data.id, data.name);
    } catch {
      toast.error('Failed to create lot');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-white/10">
        <DialogHeader>
          <DialogTitle>New Lot</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-white/60">Lot Name <span className="text-red-400">*</span></Label>
            <Input
              placeholder="e.g. Estate Sale — April 10"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              required
              className="bg-secondary/50 border-border/60"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-white/60">Source</Label>
            <Input
              placeholder="e.g. Facebook Marketplace, flea market, estate sale"
              value={form.source}
              onChange={e => setForm({ ...form, source: e.target.value })}
              className="bg-secondary/50 border-border/60"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-white/60">Notes</Label>
            <Textarea
              placeholder="Any details about this batch..."
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              className="bg-secondary/50 border-border/60 min-h-[72px] text-sm resize-none"
            />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="border-border/60">
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !form.name.trim()}>
              {saving ? 'Creating...' : 'Create Lot'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
