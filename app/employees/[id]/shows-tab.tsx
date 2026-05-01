'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Calendar, Tv, ChevronRight } from 'lucide-react';
import { createShowList, updateShowList, type ShowList } from '@/lib/api-services';
import { toast } from 'sonner';
import Link from 'next/link';

interface ShowsTabProps {
  employeeId: string;
  shows: ShowList[];
  onRefresh: () => void;
}

const statusColors: Record<string, string> = {
  draft: 'border-border/60 text-muted-foreground',
  active: 'border-emerald-500/30 text-emerald-400',
  completed: 'border-sky-500/30 text-sky-400',
  cancelled: 'border-red-500/30 text-red-400',
};

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  active: 'Live',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function ShowsTab({ employeeId, shows, onRefresh }: ShowsTabProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showName, setShowName] = useState('');
  const [showDate, setShowDate] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showName.trim()) return;
    setLoading(true);
    try {
      await createShowList({
        name: showName.trim(),
        show_date: showDate || undefined,
        managed_by_employee_id: employeeId,
      });
      toast.success('Show created');
      setShowName('');
      setShowDate('');
      setCreateOpen(false);
      onRefresh();
    } catch {
      toast.error('Failed to create show');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (showId: string, newStatus: ShowList['status']) => {
    setUpdatingId(showId);
    try {
      await updateShowList(showId, { status: newStatus });
      toast.success('Show updated');
      onRefresh();
    } catch {
      toast.error('Failed to update show');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Whatnot Shows</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{shows.length} show{shows.length !== 1 ? 's' : ''}</p>
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={() => setCreateOpen(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New Show
        </Button>
      </div>

      {shows.length === 0 ? (
        <div className="rounded-xl border border-border/40 bg-card/50 flex flex-col items-center justify-center py-12">
          <Tv className="w-8 h-8 text-muted-foreground/20 mb-3" />
          <p className="text-sm text-muted-foreground mb-1">No shows yet</p>
          <p className="text-xs text-muted-foreground/60">Create a show to get started</p>
        </div>
      ) : (
        <div className="space-y-2">
          {shows.map((show) => (
            <div key={show.id} className="rounded-xl border border-border/40 bg-card/50 p-4 flex items-center gap-4">
              <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                <Tv className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{show.name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  {show.show_date && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(show.show_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Select
                  value={show.status}
                  onValueChange={(val) => handleStatusChange(show.id, val as ShowList['status'])}
                  disabled={updatingId === show.id}
                >
                  <SelectTrigger className="h-7 text-xs w-[110px] border-border/40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Live</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Badge variant="outline" className={`text-[10px] shrink-0 ${statusColors[show.status]}`}>
                  {statusLabels[show.status]}
                </Badge>
                <Link href={`/shows/${show.id}`}>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-white">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Show</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="show-name" className="text-xs text-white/50">Show Name</Label>
              <Input
                id="show-name"
                value={showName}
                onChange={(e) => setShowName(e.target.value)}
                placeholder="e.g. Friday Night Whatnot"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="show-date" className="text-xs text-white/50">Show Date (optional)</Label>
              <Input
                id="show-date"
                type="date"
                value={showDate}
                onChange={(e) => setShowDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={loading || !showName.trim()}>
                {loading ? 'Creating...' : 'Create Show'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
