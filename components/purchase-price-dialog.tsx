'use client';

import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DollarSign } from 'lucide-react';

interface PurchasePriceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (price: number) => void;
  onSkip: () => void;
  productName: string;
  suggestedPrice?: number;
}

export function PurchasePriceDialog({
  open,
  onOpenChange,
  onConfirm,
  onSkip,
  productName,
  suggestedPrice,
}: PurchasePriceDialogProps) {
  const [price, setPrice] = useState<string>(suggestedPrice?.toString() || '');
  const [error, setError] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [open]);

  useEffect(() => {
    if (suggestedPrice !== undefined) {
      setPrice(suggestedPrice.toString());
    }
  }, [suggestedPrice]);

  const handleConfirm = () => {
    const numPrice = parseFloat(price);

    if (isNaN(numPrice)) {
      setError('Please enter a valid number');
      return;
    }

    if (numPrice < 0) {
      setError('Price cannot be negative');
      return;
    }

    if (numPrice > 100000) {
      setError('Price seems too high. Please verify.');
      return;
    }

    onConfirm(numPrice);
    setPrice('');
    setError('');
  };

  const handleSkip = () => {
    onSkip();
    setPrice('');
    setError('');
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPrice(e.target.value);
    setError('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-green-500" />
            Enter Purchase Price
          </DialogTitle>
          <DialogDescription className="text-left">
            How much did you pay for this item?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="text-sm font-medium text-muted-foreground line-clamp-2">
            {productName}
          </div>

          <div className="space-y-2">
            <Label htmlFor="purchase-price">Purchase Price</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
                ref={inputRef}
                id="purchase-price"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={price}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                className="pl-7"
              />
            </div>
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            Press <kbd className="px-1.5 py-0.5 bg-muted rounded">Enter</kbd> to save or{' '}
            <kbd className="px-1.5 py-0.5 bg-muted rounded">Esc</kbd> to skip
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={handleSkip}
          >
            Skip for Now
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
          >
            Save Price
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
