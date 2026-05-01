'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScanBarcode, TrendingUp } from 'lucide-react';

export function QuickDealScannerLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 h-12 rounded-full px-4 shadow-2xl shadow-primary/20 lg:bottom-6 lg:right-6"
      >
        <ScanBarcode className="mr-2 h-4 w-4" />
        <span className="font-semibold">Deal Check</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[92dvh] w-[calc(100vw-16px)] max-w-5xl gap-0 overflow-hidden rounded-lg border-border bg-background p-0 shadow-2xl sm:w-[min(1040px,calc(100vw-32px))]">
          <DialogHeader className="border-b border-white/10 px-4 py-3 pr-12 text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              Quick Deal Scanner
            </DialogTitle>
          </DialogHeader>
          <iframe
            title="Quick Deal Scanner"
            src="/deal-scanner?embedded=1"
            allow="camera; microphone"
            className="h-[calc(92dvh-49px)] w-full border-0 bg-background"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
