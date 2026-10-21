import Link from 'next/link';
import { FREE_SHIPPING_MINIMUM } from '@/lib/storefront-shipping-promotion';

export function ShippingProgress({ subtotal, quote, hasQuote = false, hasExcludedItems = false, hasIndividualOffers = false }: {
  subtotal: number; quote?: { cost: number; amount: number; discount: number; goal: number | null } | null; hasQuote?: boolean;
  hasExcludedItems?: boolean; hasIndividualOffers?: boolean;
}) {
  const goal = quote?.goal ?? FREE_SHIPPING_MINIMUM;
  const remaining = Math.max(0, goal - subtotal);
  const confirmed = !!quote && quote.amount === 0;
  const unavailable = !!quote && quote.goal === null && !confirmed;
  const excluded = !quote && hasExcludedItems;
  const message = confirmed ? 'Free standard shipping confirmed for this delivery quote!'
    : unavailable ? quote.discount > 0 ? 'Some items have free standard shipping. Shipping applies to the remaining packages.'
      : 'Standard shipping applies to this delivery quote.'
    : hasQuote && !quote ? 'No free-shipping offer is applied to this delivery service. Other available standard services may have different eligibility.'
    : excluded ? 'This cart includes items excluded from the whole-order free-shipping offer.'
    : remaining > 0 ? `Add $${(remaining / 100).toFixed(2)} in eligible items to ${quote ? 'reach the free-shipping target for this quote' : 'reach the $50 free-shipping minimum'}.`
    : 'You reached the free-shipping minimum! Enter your address and get shipping options to check eligibility.';
  return <section className="shipping-progress" aria-label="Free shipping progress">
    <p role="status"><strong>{message}</strong></p>
    {!unavailable && !excluded && <progress max={goal} value={confirmed ? goal : Math.min(subtotal, goal)} aria-label="Eligible merchandise toward free shipping"/>}
    {!quote && hasIndividualOffers && <p>Individually promoted items may qualify without the $50 minimum. Checkout confirms which packages qualify.</p>}
    <p>{confirmed ? 'Changes to your cart or address require a new quote.' : 'Final eligibility depends on your delivery quote. Adding items may change postage.'} <Link href="/shop/pages/shipping">Shipping offer details</Link></p>
  </section>;
}
