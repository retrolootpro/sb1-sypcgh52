'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { addressSuggestions, type AddressSuggestion } from '@/lib/storefront-address-search';

export function StorefrontAddressSearch({ onSelect, disabled = false }: {
  onSelect: (address: AddressSuggestion) => void; disabled?: boolean;
}) {
  const key = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY;
  const id = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AddressSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [composing, setComposing] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const invalidate = () => { generation.current++; controller.current?.abort(); setResults([]); setActive(-1); setBusy(false); };
  useEffect(() => {
    const version = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    if (!key || disabled || composing || !open || query.trim().length < 4) return () => abort.abort();
    const timer = setTimeout(async () => {
      setBusy(true); setMessage('');
      try {
        const params = new URLSearchParams({ text: query.trim(), apiKey: key, filter: 'countrycode:us', lang: 'en', format: 'json', limit: '5' });
        const response = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?${params}`, { signal: abort.signal, cache: 'no-store', referrerPolicy: 'strict-origin-when-cross-origin' });
        if (!response.ok) throw new Error(`Address search provider returned HTTP ${response.status}.`);
        const suggestions = addressSuggestions(await response.json());
        if (version !== generation.current || abort.signal.aborted) return;
        setResults(suggestions); setActive(-1);
        setMessage(suggestions.length ? `${suggestions.length} address suggestions available. Use the arrow keys to choose.` : 'No complete US address found. Add your city or ZIP to the search, or enter your address below.');
      } catch (cause) {
        if (abort.signal.aborted || version !== generation.current) return;
        console.warn('Storefront address search failed:', cause instanceof Error ? cause.message : 'Invalid provider response');
        setResults([]); setMessage('Address search is unavailable. Please enter your address manually below.');
      } finally { if (version === generation.current && !abort.signal.aborted) setBusy(false); }
    }, 450);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, key, open, disabled, composing]);
  const select = (result: AddressSuggestion) => {
    invalidate(); setOpen(false); setQuery(result.label); setMessage('Address filled in. Review it below and add your apartment or suite if needed.');
    onSelect(result);
  };
  if (!key) return null;
  const expanded = open && results.length > 0;
  return <div className="storefront-address-search" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) { invalidate(); setOpen(false); }
  }}>
    <label htmlFor={id}>Find your US address (optional)</label>
    <p id={`${id}-help`} className="address-search-help">Search text is sent to Geoapify. You can skip search and enter your address below. Suggestions do not guarantee delivery.</p>
    <input id={id} type="text" role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-results`}
      aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
      aria-describedby={`${id}-help ${id}-status`} autoComplete="off" maxLength={200} disabled={disabled}
      value={query} placeholder="Start with your street number and street"
      onCompositionStart={() => { invalidate(); setComposing(true); }} onCompositionEnd={() => setComposing(false)}
      onChange={event => { invalidate(); setQuery(event.target.value); setOpen(true); setMessage(''); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); invalidate(); setOpen(false); }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && expanded) {
          event.preventDefault(); setActive(current => event.key === 'ArrowDown' ? (current + 1) % results.length : (current <= 0 ? results.length - 1 : current - 1));
        }
        if (event.key === 'Enter') { event.preventDefault(); if (expanded && active >= 0) select(results[active]); }
      }}/>
    <ul id={`${id}-results`} role="listbox" aria-label="Address suggestions" hidden={!expanded}>
      {results.map((result, index) => <li role="option" aria-selected={active === index} id={`${id}-option-${index}`} key={result.label}
        onMouseDown={event => event.preventDefault()} onClick={() => select(result)}>{result.label}</li>)}
    </ul>
    <p id={`${id}-status`} role="status" className="address-search-status">{busy ? 'Searching addresses...' : message}</p>
    <p className="address-search-attribution">Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p>
  </div>;
}
