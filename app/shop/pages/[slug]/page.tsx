import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, PackageCheck } from 'lucide-react';

type Page = { title: string; intro: string; sections: { title: string; body: string }[] };
const pages: Record<string, Page> = {
  shipping: { title: 'Shipping', intro: 'Pixel & Page is online only. All purchases are shipped; local pickup and store visits are not available.', sections: [
    { title: 'Free standard shipping offer', body: 'Eligible merchandise orders of $50 or more qualify when the cheapest supported standard shipping service for all packages costs no more than $8 and no more than 15% of eligible merchandise value. The merchandise subtotal is after discounts and before tax or shipping. If either shipping limit is exceeded, normal shipping charges apply in full. Eligibility is confirmed only after your delivery address is quoted; adding items can change postage.' },
    { title: 'Individual item offers and exclusions', body: 'Items marked with an individual free-shipping offer waive the $50 minimum, not the $8 or 15% limits. In mixed carts, only packages containing exclusively individually promoted items qualify for that offer; their combined postage must stay within $8 and 15% of their combined merchandise value. Other packages are charged normally unless the full order qualifies. Excluded items do not count toward the minimum and prevent the whole-order offer; separate individually promoted packages may still qualify. Only the cheapest supported standard service is discounted; other services remain paid options.' },
    { title: 'Destinations and charges', body: 'Available shipping destinations and configured delivery options are shown in Stripe Checkout before payment. Shipping charges and applicable tax are included in the final total. If no option is available for your address, contact support before purchasing.' },
    { title: 'Delivery and tracking', body: 'Your shipping address is collected securely during checkout. Contact support with your order reference for processing or tracking questions. Delivery dates are estimates, not guarantees.' },
    { title: 'Requested items', body: 'We review requests and source items into RetroLoot inventory before sending a Stripe invoice. Review the item, shipping address, shipping charge, and total before paying.' },
  ] },
  returns: { title: 'Returns & order issues', intro: 'We want every listing to be clear and every order to arrive as described.', sections: [
    { title: 'Contact support first', body: 'Email support@pixelandpagellc.com with your order reference, item name, and photos when appropriate. Do not mail an item back until you receive return instructions.' },
    { title: 'Condition-specific inventory', body: 'Pre-owned items can show normal wear. Review the exact listing, condition, photos, and included accessories before purchasing.' },
    { title: 'Damaged or incorrect items', body: 'Contact us promptly so we can review the issue and explain the available resolution. Refunds, when approved, are processed through the original payment method.' },
    { title: 'Other marketplaces', body: 'Orders placed through eBay or Whatnot remain subject to that platform’s support and return process.' },
  ] },
  faq: { title: 'Frequently asked questions', intro: 'Shopping, requests, shipping, and payments at Pixel & Page.', sections: [
    { title: 'Where does inventory come from?', body: 'The catalog reads current in-stock, priced inventory from our connected RetroLoot account. Stock and pricing are rechecked when checkout starts; keeping an item in your cart does not reserve it.' },
    { title: 'Can I pick up an order?', body: 'No. We are online only and ship all orders. Our former physical store is closed.' },
    { title: 'Can you find an item for me?', body: 'Submit an item request with the title, platform, condition preferences, and your contact/shipping information. A request is not a purchase or a guarantee of availability.' },
    { title: 'How do I pay for a requested item?', body: 'After reviewing availability, we can email a Stripe-hosted invoice. Check the item details, shipping, tax, and total, then pay securely using the invoice link.' },
  ] },
  contact: { title: 'Contact Pixel & Page', intro: 'Email support@pixelandpagellc.com for help. Pixel & Page is online only; there is no storefront or local pickup.', sections: [
    { title: 'Order support', body: 'Include your order reference and item name. Never email payment-card details or passwords.' },
    { title: 'Looking for something?', body: 'Use our item-request form so we can review the exact title, platform, and preferences. We will email you after reviewing availability.' },
    { title: 'Collections and other questions', body: 'Contact support before sending any merchandise. We do not accept unarranged drop-offs or shipments.' },
  ] },
  'trade-ins': { title: 'Collections & trade inquiries', intro: 'We are online only. Please email support before sending any items.', sections: [
    { title: 'Start with a conversation', body: 'Send a concise list and condition details. Do not mail a collection without an explicit agreement and shipping instructions.' },
    { title: 'Review before any offer', body: 'Availability, acceptance, and any offer depend on the collection and inspection. This website does not guarantee a buyback, cash offer, or store credit.' },
  ] },
  'store-info': { title: 'Online-only shopping', intro: 'Our physical store is closed. Pixel & Page now serves customers online with shipping.', sections: [
    { title: 'Browse our shelves online', body: 'Explore current RetroLoot inventory, search for a favorite, or request an item you cannot find.' },
    { title: 'Customer support', body: 'Email support@pixelandpagellc.com. No store visits, drop-offs, or local pickup are available.' },
  ] },
  'our-story': { title: 'Every story has a save point', intro: 'Games, books, and collectibles together in one online shop.', sections: [
    { title: 'For players and readers', body: 'Pixel & Page brings favorite games and great reads to the same shelf. We are now online only and ship purchases to our customers.' },
    { title: 'Real inventory', body: 'RetroLoot powers the catalog and inventory-backed purchases. Looking for something missing? Send an item request and we will review it.' },
  ] },
  privacy: { title: 'Privacy', intro: 'We use customer information to review requests, process purchases, ship orders, and provide support.', sections: [
    { title: 'Information you provide', body: 'Item requests collect your name, email, shipping address, and request details. Orders contain item, shipping, contact, and payment-status information. Please do not include sensitive information in request notes.' },
    { title: 'Service providers', body: 'Our hosting and database providers process information needed to operate the store. Stripe securely handles payment information, invoices, tax calculations, and configured shipping charges. Card details are not stored in RetroLoot.' },
    { title: 'Optional address search', body: 'When you type in the optional address-search box, the search text is sent to Geoapify to suggest US addresses. You may skip search and enter your address manually. Suggestions are not a guarantee of postal delivery. Shippo processes delivery and package details to quote shipping and purchase postage when authorized by staff.' },
    { title: 'Questions and deletion requests', body: 'Email support@pixelandpagellc.com with privacy questions or requests. Records needed for accounting, legal, or order obligations may need to be retained.' },
  ] },
  terms: { title: 'Website terms', intro: 'Review the exact item, shipping address, and final total before paying.', sections: [
    { title: 'Inventory and requests', body: 'Inventory is limited. A cart does not reserve stock. Starting checkout temporarily reserves available quantities; expired or cancelled unpaid checkouts release them. Item requests are not purchases or guarantees of availability.' },
    { title: 'Payment and fulfillment', body: 'When enabled, payments are processed on Stripe-hosted pages. Applicable tax and configured shipping charges are shown before payment. All orders are shipped; local pickup is not available.' },
    { title: 'Product details', body: 'Review condition, photos, and included accessories. Contact support about material listing errors or order issues before returning an item.' },
  ] },
  help: { title: 'How can we help?', intro: 'Support for shopping online with Pixel & Page.', sections: [
    { title: 'Orders and delivery', body: 'Review shipping and return information, or email support@pixelandpagellc.com with your order reference.' },
    { title: 'Product questions and requests', body: 'Use the exact title when asking about compatibility or condition. If you cannot find an item, submit an item request.' },
    { title: 'Secure payment', body: 'Checkout and invoice payments take place on Stripe-hosted pages. Never share your card details by email.' },
  ] },
};

export default function InformationPage({ params }: { params: { slug: string } }) {
  const page = pages[params.slug];
  if (!page) notFound();
  return <main className="commerce-page">
    <Link href="/shop" className="commerce-breadcrumbs"><ArrowLeft size={14}/> Back to shop</Link>
    <header className="commerce-page-header"><p className="commerce-kicker">PIXEL & PAGE</p><h1>{page.title}</h1><p>{page.intro}</p></header>
    <div className="commerce-page-grid">{page.sections.map((section) => <article className="commerce-page-card" key={section.title}><PackageCheck/><h2>{section.title}</h2><p>{section.body}</p></article>)}</div>
    <div className="reference-page-actions"><Link href="/shop/request">Request an item</Link><a href="mailto:support@pixelandpagellc.com">Email support</a><Link href="/shop/pages/shipping">Shipping</Link><Link href="/shop/pages/returns">Returns</Link></div>
  </main>;
}
