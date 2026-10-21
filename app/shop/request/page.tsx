'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { requestSchema } from '@/lib/storefront-model';

export default function ItemRequestPage() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setError('');
    const values = new FormData(form);
    try {
      const value = (key: string) => String(values.get(key) || '');
      const input = requestSchema.parse({ name:value('name'),email:value('email'),item:value('item'),platform:value('platform'),
        notes:value('notes'),website:value('website'),address:{line1:value('line1'),line2:value('line2'),city:value('city'),state:value('state'),postal_code:value('postal_code'),country:value('country').toUpperCase()} });
      const response = await fetch('/api/storefront/requests', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Request could not be submitted.');
      setMessage(result.message); form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed. Please email support.'); }
    finally {setBusy(false);}
  };
  return <main className="commerce-page">
    <header className="commerce-page-header"><p className="commerce-kicker">LET US HELP YOU FIND IT</p><h1>Request an item</h1><p>Can&apos;t find a game, book, or collectible? Tell us what you&apos;re looking for. We&apos;ll review availability and email you. No payment is taken by this form.</p></header>
    {message ? <section className="commerce-page-card" role="status"><h2>Request received</h2><p>{message}</p><Link href="/shop">Back to the shop</Link></section> :
      <form onSubmit={submit} className="reference-form commerce-page-card">
        <div className="reference-form-grid">
          <label>Your name<input name="name" autoComplete="name" required minLength={2} maxLength={100}/></label>
          <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254}/></label>
          <label>Item title<input name="item" defaultValue={params.get('item') || ''} required minLength={3} maxLength={200}/></label>
          <label>Platform / format<input name="platform" placeholder="e.g. SNES, paperback" maxLength={100}/></label>
          <label className="reference-full">Preferences and notes<textarea name="notes" rows={4} maxLength={2000} placeholder="Condition, edition, budget, or other details. Do not include payment details."/></label>
        </div>
        <fieldset><legend>Shipping address for a possible invoice</legend><p>We ship orders only. This lets us prepare the correct shipping and tax if we find your item.</p>
          <div className="reference-form-grid">
            <label className="reference-full">Address line 1<input name="line1" autoComplete="shipping address-line1" required maxLength={150}/></label>
            <label className="reference-full">Address line 2 (optional)<input name="line2" autoComplete="shipping address-line2" maxLength={150}/></label>
            <label>City<input name="city" autoComplete="shipping address-level2" required maxLength={100}/></label>
            <label>State / province<input name="state" autoComplete="shipping address-level1" required maxLength={100}/></label>
            <label>Postal code<input name="postal_code" autoComplete="shipping postal-code" required maxLength={20}/></label>
            <label>Country code<input name="country" autoComplete="shipping country" placeholder="US" required pattern="[A-Za-z]{2}" maxLength={2}/></label>
          </div>
        </fieldset>
        <label className="reference-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off"/></label>
        <p>Submitting a request does not reserve stock or commit you to a purchase. If available, we may email a Stripe invoice for you to review and pay. See our <Link href="/shop/pages/privacy">privacy policy</Link>.</p>
        {error && <p role="alert" className="reference-error">{error}</p>}
        <button type="submit" className="reference-primary" disabled={busy}>{busy?'Submitting…':'Submit request'}</button>
      </form>}
  </main>;
}
