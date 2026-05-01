'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Plus, Calendar, Package } from 'lucide-react';
import { CreateShowDialog } from '@/components/create-show-dialog';
import Link from 'next/link';
import { format } from 'date-fns';

type ShowList = {
  id: string;
  name: string;
  show_date: string | null;
  created_at: string;
  show_items: {
    id: string;
  }[];
};

export default function ShowsPage() {
  const { user } = useAuth();
  const [shows, setShows] = useState<ShowList[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const loadShows = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('show_lists')
        .select(`
          *,
          show_items (id)
        `)
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setShows(data as ShowList[]);
    } catch (error) {
      console.error('Error loading shows:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadShows();
    }
  }, [user, loadShows]);

  return (
    <DashboardLayout>
      <div className="p-8 lg:p-10 space-y-8 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <div className="label-caps mb-1">Business</div>
            <h1 className="heading-lg text-[22px]">Show Builder</h1>
          </div>
          <Button size="sm" className="h-9" onClick={() => setShowCreateDialog(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Create Show
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-7 w-7 border-2 border-primary border-t-transparent"></div>
          </div>
        ) : shows.length === 0 ? (
          <div className="rounded-2xl border border-border/40 bg-card">
            <div className="flex flex-col items-center justify-center py-16">
              <Package className="w-10 h-10 mb-3 text-muted-foreground/20" />
              <h3 className="text-sm font-medium mb-1">No shows yet</h3>
              <p className="text-xs text-muted-foreground mb-4 text-center max-w-md">
                Create your first show list to organize inventory for Whatnot live selling
              </p>
              <Button size="sm" onClick={() => setShowCreateDialog(true)}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Create Your First Show
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {shows.map((show) => (
              <Link key={show.id} href={`/shows/${show.id}`}>
                <div className="rounded-2xl border border-border/40 bg-card hover:bg-card/80 hover:border-border/60 transition-all p-5 cursor-pointer h-full">
                  <div className="font-semibold text-sm truncate mb-1">{show.name}</div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
                    {show.show_date ? (
                      <>
                        <Calendar className="w-3.5 h-3.5" />
                        {format(new Date(show.show_date), 'MMM d, yyyy')}
                      </>
                    ) : (
                      'No date set'
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Package className="w-3.5 h-3.5" />
                      {show.show_items.length} item{show.show_items.length !== 1 ? 's' : ''}
                    </div>
                    <div className="text-[11px] text-muted-foreground/60">
                      Created {format(new Date(show.created_at), 'MMM d')}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        <CreateShowDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onSuccess={loadShows}
        />
      </div>
    </DashboardLayout>
  );
}
