import Link from 'next/link';
import { ArrowLeft, BookOpen, Clock3, Mail, MapPin, PackageCheck, RefreshCcw, ShieldCheck, Store, Truck } from 'lucide-react';

const pages: Record<string, { title: string; eyebrow: string; intro: string; sections: { title: string; body: string }[] }> = {
  'shipping': {
    title: 'Shipping & local pickup', eyebrow: 'ORDER FULFILLMENT', intro: 'Choose the option that works best for you. Exact availability is confirmed during checkout.', sections: [
      { title: 'Shipping', body: 'Orders are packed using the condition and product details attached to the exact RetroLootPro inventory record. Tracking is provided when the order ships.' },
      { title: 'Local pickup', body: 'Select local pickup during checkout to collect your order at Pixel & Page in the Daytona Flea Market. Wait for the pickup-ready confirmation before making the trip.' },
      { title: 'Processing time', body: 'Most in-stock orders are prepared within one to two business days. Flea market operating days and holidays may affect pickup timing.' },
      { title: 'Order issues', body: 'Contact Pixel & Page promptly if tracking stalls, an order arrives damaged, or the delivered item does not match the listing.' },
    ],
  },
  'returns': {
    title: 'Returns & order issues', eyebrow: 'CUSTOMER CARE', intro: 'We want every listing to be clear and every order to arrive as described.', sections: [
      { title: 'Contact us first', body: 'Email us with the order information and photos when appropriate. Do not send an item back before receiving return instructions.' },
      { title: 'Condition-specific inventory', body: 'Pre-owned games, consoles, books, and collectibles can show normal wear. The product page and photos are part of the item description.' },
      { title: 'Damaged or incorrect orders', body: 'Report damage or an incorrect item promptly so we can review the order and provide the appropriate resolution.' },
      { title: 'Platform purchases', body: 'Items purchased through eBay or Whatnot remain subject to that platform’s checkout and return process.' },
    ],
  },
  'faq': {
    title: 'Frequently asked questions', eyebrow: 'HELP CENTER', intro: 'Quick answers about inventory, pickup, shipping, and trade-ins.', sections: [
      { title: 'Is the inventory really available?', body: 'Yes. Published products come directly from RetroLootPro and automatically disappear when quantity reaches zero or the item is archived.' },
      { title: 'Can I pick up an online order?', body: 'Yes. Choose local pickup during checkout and wait for the pickup-ready confirmation.' },
      { title: 'Are games and consoles tested?', body: 'Testing and condition details are shown on each product. Read the exact listing because condition can vary by item.' },
      { title: 'Do you buy collections?', body: 'Yes. Pixel & Page buys and trades games, consoles, books, and collectibles. Large collections may require an appointment.' },
      { title: 'Can you hold an item?', body: 'An item is not reserved until checkout is completed. One-of-a-kind inventory can sell quickly.' },
    ],
  },
  'contact': {
    title: 'Contact Pixel & Page', eyebrow: 'WE ARE HERE TO HELP', intro: 'Questions about an order, trade-in, item condition, or store visit are welcome.', sections: [
      { title: 'Online order support', body: 'Include your order number, the email used at checkout, and a clear description of the issue.' },
      { title: 'Trade-in questions', body: 'Send a concise list or photos of the collection. Final offers require an in-person condition review.' },
      { title: 'Store visit', body: 'Pixel & Page operates inside the Daytona Flea Market. Review the store information page before traveling.' },
    ],
  },
  'trade-ins': {
    title: 'Sell or trade with Pixel & Page', eyebrow: 'TURN OLD FAVORITES INTO NEW ONES', intro: 'Bring us games, consoles, books, and collectibles for a straightforward in-store offer.', sections: [
      { title: '1. Bring your items', body: 'Clean, organized items with cases, cables, accessories, and original packaging are easier to evaluate.' },
      { title: '2. We inspect and test', body: 'Offers consider condition, completeness, current demand, duplicate stock, and the time required to prepare the item for resale.' },
      { title: '3. Choose cash or credit', body: 'Cash is available for accepted inventory. Store credit may provide more value when you want to trade into another item.' },
      { title: 'Large collections', body: 'Contact us before bringing a very large collection so we can set aside enough time and space for evaluation.' },
    ],
  },
  'store-info': {
    title: 'Visit Pixel & Page', eyebrow: 'DAYTONA FLEA MARKET', intro: 'Shop the full selection, pick up an online order, or bring in a collection for review.', sections: [
      { title: 'Location', body: 'Pixel & Page is located inside the Daytona Flea Market. Follow current Pixel & Page social updates for booth directions and operating notices.' },
      { title: 'Typical schedule', body: 'The store generally operates Friday through Sunday during flea market hours. Weather, holidays, and market schedules can affect availability.' },
      { title: 'Pickup orders', body: 'Wait for confirmation that your order is ready before arriving. Bring identification and the order confirmation.' },
      { title: 'In-store selection', body: 'The storefront displays published inventory, while additional merchandise, value bins, and newly received items may also be available in person.' },
    ],
  },
  'our-story': {
    title: 'Every story has a save point', eyebrow: 'ABOUT PIXEL & PAGE', intro: 'Pixel & Page brings games, books, and collectibles together in one welcoming local shop.', sections: [
      { title: 'For players and readers', body: 'The store is built around the idea that a favorite game and a favorite book can belong on the same shelf.' },
      { title: 'Real inventory, carefully managed', body: 'RetroLootPro connects the public catalog with the inventory used to operate the business, reducing stale listings and overselling.' },
      { title: 'Local first, online too', body: 'Customers can browse in person at the Daytona Flea Market or shop live published inventory online.' },
    ],
  },
  'privacy': {
    title: 'Privacy policy', eyebrow: 'YOUR INFORMATION', intro: 'Pixel & Page uses customer information only to operate the store, fulfill orders, provide support, and improve the shopping experience.', sections: [
      { title: 'Information collected', body: 'Checkout and support may require contact, delivery, order, and transaction information. Payment details are processed by Clover rather than stored directly by Pixel & Page.' },
      { title: 'How information is used', body: 'Information is used for fulfillment, communication, fraud prevention, legal compliance, and optional marketing when consent is provided.' },
      { title: 'Service providers', body: 'Necessary information may be processed by hosting, database, shipping, commerce, and payment providers used to run the store.' },
      { title: 'Questions', body: 'Contact Pixel & Page with privacy questions or requests regarding your customer information.' },
    ],
  },
  'terms': {
    title: 'Website terms', eyebrow: 'STORE POLICIES', intro: 'By using this storefront, customers agree to the product, payment, fulfillment, and support terms shown during checkout.', sections: [
      { title: 'Inventory availability', body: 'Inventory is limited and may be one of a kind. A cart does not reserve an item until payment is completed.' },
      { title: 'Product condition', body: 'Customers should review photos, condition labels, descriptions, and included accessories before purchasing.' },
      { title: 'Pricing and errors', body: 'Pixel & Page may correct material listing or pricing errors before fulfillment and will communicate when an order is affected.' },
      { title: 'Payment', body: 'Online payment is processed using Clover Hosted Checkout and may be subject to Clover’s terms and fraud controls.' },
    ],
  },
  'help': {
    title: 'How can we help?', eyebrow: 'PIXEL & PAGE SUPPORT', intro: 'Find answers, review store policies, or contact us about an order.', sections: [
      { title: 'Orders and delivery', body: 'Review shipping, pickup, and return information before contacting support.' },
      { title: 'Product questions', body: 'Use the exact product title when asking about condition, compatibility, or included accessories.' },
      { title: 'Trade-ins', body: 'Review the trade-in process and contact us before bringing a large collection.' },
    ],
  },
};

export default function InformationPage({ params }: { params: { slug: string } }) {
  const page = pages[params.slug] || pages.help;
  const icons = [Truck, PackageCheck, ShieldCheck, RefreshCcw, Store, MapPin, Mail, Clock3, BookOpen];
  return <main className="commerce-page">
    <Link href="/shop" className="commerce-breadcrumbs"><ArrowLeft size={14}/> Back to shop</Link>
    <header className="commerce-page-header"><p className="commerce-kicker">{page.eyebrow}</p><h1>{page.title}</h1><p>{page.intro}</p></header>
    <div className="commerce-page-grid">{page.sections.map((section, index) => { const Icon = icons[index % icons.length]; return <article className="commerce-page-card" key={section.title}><Icon style={{color:'#2b8b86'}}/><h3>{section.title}</h3><p>{section.body}</p></article>; })}</div>
  </main>;
}
