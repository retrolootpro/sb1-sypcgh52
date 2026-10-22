'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TrendingUp } from 'lucide-react';

export function QuickDealScannerLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
      <Button
        variant="outline"
        aria-label="Open Quick Deal Scanner"
        className="workspace-deal-check"
      >
        <TrendingUp className="h-4 w-4" />
        <span className="font-semibold">Deal Check</span>
      </Button>
      </DialogTrigger>
        <DialogContent className="h-[92dvh] w-[calc(100vw-16px)] max-w-5xl gap-0 overflow-hidden rounded-lg border-border bg-background p-0 shadow-2xl sm:w-[min(1040px,calc(100vw-32px))]">
          <DialogHeader className="border-b border-white/10 px-4 py-3 pr-12 text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              Quick Deal Scanner
            </DialogTitle>
          </DialogHeader>
          <iframe
            title="Quick Deal Scanner"
            src="/business/deal-scanner?embedded=1"
            onLoad={event => {
              event.currentTarget.contentDocument?.addEventListener('keydown', key => {
                if (key.key === 'Escape' && !key.defaultPrevented) { key.preventDefault(); setOpen(false); }
              });
            }}
            allow="camera; microphone"
            className="h-[calc(92dvh-49px)] w-full border-0 bg-background"
          />
        </DialogContent>
    </Dialog>
  );
}
