'use client';

import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, DollarSign, Monitor, ChevronDown } from 'lucide-react';
import { REGIONS } from '@/lib/constants';

export const CONSOLE_OPTIONS = [
  { group: 'Books & Media', options: ['Book', 'Manga', 'Comic', 'Graphic Novel', 'Strategy Guide'] },
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
  onConfirm: (purchasePrice: number, console: string, region: string, titleOverride?: string, bookMetadataOverride?: Record<string, unknown>) => void;
  onSkip: () => void;
  productName: string;
  detectedConsole: string | null;
  suggestedPrice?: number;
  allowTitleEdit?: boolean;
  bookMetadata?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    publishedYear?: string;
    description?: string;
    pageCount?: number | null;
    categories?: string[];
    language?: string;
    isbn10?: string;
    isbn13?: string;
    coverImageUrl?: string;
    source?: string;
    sourcesTried?: string[];
  } | null;
  duplicateMatches?: Array<{
    id: string;
    product_name: string;
    console: string | null;
    condition: string | null;
    created_at: string | null;
  }>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] text-muted-foreground">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="h-10 bg-secondary/40 border-border/60 text-[13px]"
      />
    </div>
  );
}

export function ScanItemDialog({
  open,
  onOpenChange,
  onConfirm,
  onSkip,
  productName,
  detectedConsole,
  suggestedPrice,
  allowTitleEdit = false,
  bookMetadata = null,
  duplicateMatches = [],
}: ScanItemDialogProps) {
  const [editableTitle, setEditableTitle] = useState(productName || '');
  const [subtitle, setSubtitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [publisher, setPublisher] = useState('');
  const [publishedDate, setPublishedDate] = useState('');
  const [pageCount, setPageCount] = useState('');
  const [categories, setCategories] = useState('');
  const [language, setLanguage] = useState('');
  const [isbn10, setIsbn10] = useState('');
  const [isbn13, setIsbn13] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState<string>(suggestedPrice?.toString() || '');
  const [consoleValue, setConsoleValue] = useState<string>(detectedConsole || '');
  const [region, setRegion] = useState('US');
  const [titleError, setTitleError] = useState('');
  const [priceError, setPriceError] = useState('');
  const [consoleError, setConsoleError] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const meta = bookMetadata || {};
      setEditableTitle(productName || '');
      setSubtitle(meta.subtitle || '');
      setAuthors(Array.isArray(meta.authors) ? meta.authors.join(', ') : '');
      setPublisher(meta.publisher || '');
      setPublishedDate(meta.publishedDate || meta.publishedYear || '');
      setPageCount(meta.pageCount ? String(meta.pageCount) : '');
      setCategories(Array.isArray(meta.categories) ? meta.categories.join(', ') : '');
      setLanguage(meta.language || '');
      setIsbn10(meta.isbn10 || '');
      setIsbn13(meta.isbn13 || '');
      setCoverImageUrl(meta.coverImageUrl || '');
      setDescription(meta.description || '');
      setConsoleValue(detectedConsole || '');
      setRegion('US');
      setTitleError('');
      setPrice(suggestedPrice?.toString() || '');
      setPriceError('');
      setConsoleError('');
      setTimeout(() => {
        if (allowTitleEdit) {
          titleInputRef.current?.focus();
          titleInputRef.current?.select();
          return;
        }
        if (!detectedConsole) return;
        priceInputRef.current?.focus();
        priceInputRef.current?.select();
      }, 120);
    }
  }, [open, detectedConsole, productName, suggestedPrice, allowTitleEdit, bookMetadata]);

  const handleConfirm = () => {
    let valid = true;
    const cleanTitle = editableTitle.trim();

    if (allowTitleEdit && !cleanTitle) {
      setTitleError('Enter the book title');
      valid = false;
    }

    const numPrice = price.trim() === '' ? 0 : parseFloat(price);
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

    const metadataOverride = allowTitleEdit ? {
      title: cleanTitle,
      subtitle: subtitle.trim(),
      authors: authors.split(',').map((value) => value.trim()).filter(Boolean),
      publisher: publisher.trim(),
      publishedDate: publishedDate.trim(),
      publishedYear: publishedDate.match(/\d{4}/)?.[0] || '',
      description: description.trim(),
      pageCount: pageCount.trim() === '' ? null : Number(pageCount),
      categories: categories.split(',').map((value) => value.trim()).filter(Boolean),
      language: language.trim(),
      isbn10: isbn10.trim(),
      isbn13: isbn13.trim(),
      coverImageUrl: coverImageUrl.trim(),
      source: bookMetadata?.source || 'manual_book_metadata',
      sourcesTried: bookMetadata?.sourcesTried || [],
    } : undefined;

    onConfirm(numPrice, consoleValue.trim(), region, allowTitleEdit ? cleanTitle : undefined, metadataOverride);
    setEditableTitle('');
    setPrice('');
    setConsoleValue('');
    setRegion('US');
    setTitleError('');
    setPriceError('');
    setConsoleError('');
  };

  const handleSkip = () => {
    onSkip();
    setEditableTitle('');
    setPrice('');
    setConsoleValue('');
    setRegion('US');
    setTitleError('');
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
          {allowTitleEdit ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
              <Label className="text-[12px] text-muted-foreground">
                Book Title
              </Label>
              <Input
                ref={titleInputRef}
                value={editableTitle}
                onChange={(e) => { setEditableTitle(e.target.value); setTitleError(''); }}
                onKeyDown={handleKeyDown}
                className="h-10 bg-secondary/40 border-border/60 text-[13px]"
                placeholder="Enter book title..."
              />
              {titleError && <p className="text-[12px] text-red-400">{titleError}</p>}
              <p className="text-[11px] text-muted-foreground/70">
                Review and edit the book metadata before saving. The barcode will be saved with this item.
              </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="Subtitle" value={subtitle} onChange={setSubtitle} placeholder="Optional subtitle" />
                <Field label="Authors" value={authors} onChange={setAuthors} placeholder="Author 1, Author 2" />
                <Field label="Publisher" value={publisher} onChange={setPublisher} placeholder="Publisher" />
                <Field label="Published" value={publishedDate} onChange={setPublishedDate} placeholder="Year or date" />
                <Field label="Pages" value={pageCount} onChange={setPageCount} placeholder="Page count" inputMode="numeric" />
                <Field label="Language" value={language} onChange={setLanguage} placeholder="en" />
                <Field label="ISBN-10" value={isbn10} onChange={setIsbn10} placeholder="ISBN-10" />
                <Field label="ISBN-13" value={isbn13} onChange={setIsbn13} placeholder="ISBN-13" />
              </div>

              <Field label="Categories" value={categories} onChange={setCategories} placeholder="Juvenile Fiction, Horror" />
              <Field label="Cover Image URL" value={coverImageUrl} onChange={setCoverImageUrl} placeholder="https://..." />
              <div className="space-y-1.5">
                <Label className="text-[12px] text-muted-foreground">Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[72px] bg-secondary/40 border-border/60 text-[13px]"
                  placeholder="Book description..."
                />
              </div>
            </div>
          ) : (
            <div className="px-3 py-2.5 rounded-md bg-secondary/50 border border-border/40">
              <p className="text-[13px] font-medium text-foreground/90 leading-snug line-clamp-2">
                {productName || 'Unknown Product'}
              </p>
            </div>
          )}

          {duplicateMatches.length > 0 && (
            <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <div>
                  <div className="text-[13px] font-semibold text-amber-100">
                    Possible duplicate in inventory
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-100/75">
                    {duplicateMatches.length} matching item{duplicateMatches.length === 1 ? '' : 's'} already in stock.
                    Save Item will add another copy. Skip will ignore this scan.
                  </p>
                  <div className="mt-2 space-y-1">
                    {duplicateMatches.slice(0, 3).map((match) => (
                      <div key={match.id} className="text-[11px] text-amber-100/70">
                        {match.product_name} {match.console ? `(${match.console})` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

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
              Cost Override
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[13px]">$</span>
              <Input
                ref={priceInputRef}
                type="number"
                step="0.01"
                min="0"
                placeholder="Leave blank for lot allocation"
                value={price}
                onChange={(e) => { setPrice(e.target.value); setPriceError(''); }}
                onKeyDown={handleKeyDown}
                className="pl-7 h-10 bg-secondary/40 border-border/60 text-[13px]"
              />
            </div>
            {priceError && <p className="text-[12px] text-red-400">{priceError}</p>}
            <p className="text-[11px] text-muted-foreground/60">
              Optional for single-item buys. Lot scans will allocate cost after market values are totaled.
              {' '}Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> to save
              {' '}or <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Esc</kbd> to skip
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12px] text-muted-foreground">
              Region / TV Standard
            </Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger className="h-10 bg-secondary/40 border-border/60 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value} className="text-[13px]">
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
