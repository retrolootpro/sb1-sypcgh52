'use client';

import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DollarSign, Monitor, ChevronDown } from 'lucide-react';

export const CONSOLE_OPTIONS = [
  { group: 'Sony', options: ['PlayStation 5', 'PlayStation 4', 'PlayStation 3', 'PlayStation 2', 'PlayStation', 'PS Vita', 'PSP'] },
  { group: 'Microsoft', options: ['Xbox Series X/S', 'Xbox One', 'Xbox 360', 'Xbox'] },
  { group: 'Nintendo', options: ['Switch', 'Wii U', 'Wii', 'GameCube', 'N64', 'SNES', 'NES', '3DS', 'DS', 'Game Boy Advance', 'Game Boy Color', 'Game Boy'] },
  { group: 'Sega', options: ['Sega Genesis', 'Sega Dreamcast', 'Sega Saturn'] },
  { group: 'Other', options: ['PC', 'Other'] },
];

export const ALL_CONSOLES = CONSOLE_OPTIONS.flatMap((g) => g.options);

interface ScanItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (purchasePrice: number, console: string) => void;
  onSkip: () => void;
  productName: string;
  detectedConsole: string | null;
  suggestedPrice?: number;
}

export function ScanItemDialog({
  open,
  onOpenChange,
  onConfirm,
  onSkip,
  productName,
  detectedConsole,
  suggestedPrice,
}: ScanItemDialogProps) {
  const [price, setPrice] = useState<string>(suggestedPrice?.toString() || '');
  const [consoleValue, setConsoleValue] = useState<string>(detectedConsole || '');
  const [priceError, setPriceError] = useState('');
  const [consoleError, setConsoleError] = useState('');
  const priceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setConsoleValue(detectedConsole || '');
      setPrice(suggestedPrice?.toString() || '');
      setPriceError('');
      setConsoleError('');
      setTimeout(() => {
        if (!detectedConsole) return;
        priceInputRef.current?.focus();
        priceInputRef.current?.select();
      }, 120);
    }
  }, [open, detectedConsole, suggestedPrice]);

  const handleConfirm = () => {
    let valid = true;

    const numPrice = parseFloat(price);
    if (isNaN(numPrice) || numPrice < 0) {
      setPriceError('Enter a valid price (0 or more)');
      valid = false;
    } else if (numPrice > 100000) {
      setPriceError('Price seems too high');
      valid = false;
    }

    if (!consoleValue.trim()) {
      setConsoleError('Select or enter a console');
      valid = false;
    }

    if (!valid) return;

    onConfirm(numPrice, consoleValue.trim());
    setPrice('');
    setConsoleValue('');
    setPriceError('');
    setConsoleError('');
  };

  const handleSkip = () => {
    onSkip();
    setPrice('');
    setConsoleValue('');
    setPriceError('');
    setConsoleError('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleSkip();
    }
  };

  const consoleAutoDetected = !!detectedConsole;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border/60">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-semibold tracking-tight">
            Confirm Item Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="px-3 py-2.5 rounded-md bg-secondary/50 border border-border/40">
            <p className="text-[13px] font-medium text-foreground/90 leading-snug line-clamp-2">
              {productName || 'Unknown Product'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12px] text-muted-foreground flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5" />
              Console / Platform
              {consoleAutoDetected && (
                <span className="text-[10px] font-semibold text-primary uppercase tracking-wider ml-1">auto-detected</span>
              )}
            </Label>

            {consoleAutoDetected ? (
              <div className="flex gap-2">
                <Input
                  value={consoleValue}
                  onChange={(e) => { setConsoleValue(e.target.value); setConsoleError(''); }}
                  onKeyDown={handleKeyDown}
                  className="h-10 bg-secondary/40 border-border/60 text-[13px]"
                  placeholder="Console name..."
                />
                <Select value={consoleValue} onValueChange={(v) => { setConsoleValue(v); setConsoleError(''); }}>
                  <SelectTrigger className="w-10 h-10 px-2 bg-secondary/40 border-border/60 flex-shrink-0">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {CONSOLE_OPTIONS.map((group) => (
                      <div key={group.group}>
                        <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{group.group}</div>
                        {group.options.map((c) => (
                          <SelectItem key={c} value={c} className="text-[13px]">{c}</SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <Select value={consoleValue} onValueChange={(v) => { setConsoleValue(v); setConsoleError(''); }}>
                <SelectTrigger className="h-10 bg-secondary/40 border-border/60 text-[13px]">
                  <SelectValue placeholder="Select console..." />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {CONSOLE_OPTIONS.map((group) => (
                    <div key={group.group}>
                      <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{group.group}</div>
                      {group.options.map((c) => (
                        <SelectItem key={c} value={c} className="text-[13px]">{c}</SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            )}
            {consoleError && <p className="text-[12px] text-red-400">{consoleError}</p>}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12px] text-muted-foreground flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5" />
              Purchase Price
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[13px]">$</span>
              <Input
                ref={priceInputRef}
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={price}
                onChange={(e) => { setPrice(e.target.value); setPriceError(''); }}
                onKeyDown={handleKeyDown}
                className="pl-7 h-10 bg-secondary/40 border-border/60 text-[13px]"
              />
            </div>
            {priceError && <p className="text-[12px] text-red-400">{priceError}</p>}
            <p className="text-[11px] text-muted-foreground/60">
              Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> to save
              {' '}or <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Esc</kbd> to skip
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={handleSkip} className="text-[13px]">
            Skip
          </Button>
          <Button size="sm" onClick={handleConfirm} className="text-[13px] flex-1">
            Save Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
