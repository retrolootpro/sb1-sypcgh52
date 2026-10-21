import Link from 'next/link';
import { ArrowLeft, Mail, PackageSearch, UserRound } from 'lucide-react';

export default function AccountPage() {
  return <main className="commerce-page">
    <Link href="/shop" className="commerce-breadcrumbs"><ArrowLeft size={14}/> Back to shop</Link>
    <header className="commerce-page-header"><p className="commerce-kicker">CUSTOMER SUPPORT</p><h1>Orders and support</h1><p>No customer account is required. Use your Stripe receipt or invoice email for your payment reference, or contact our online support team.</p></header>
    <div className="commerce-page-grid">
      <article className="commerce-page-card"><PackageSearch style={{color:'#2b8b86'}}/><h3>Need help with a purchase?</h3><p>Include the purchase date and item name when contacting support.</p><Link href="/shop/pages/contact" style={{fontWeight:800,color:'#2b8b86'}}>Contact customer care</Link></article>
      <article className="commerce-page-card"><UserRound/><h3>Looking for an item?</h3><p>Tell us what you need. We can review availability and send a secure invoice after sourcing it into inventory.</p><Link href="/shop/request">Submit an item request</Link></article>
      <article className="commerce-page-card"><Mail style={{color:'#2b8b86'}}/><h3>Purchased on another platform?</h3><p>eBay and Whatnot orders remain managed through the account and support tools on the platform where the purchase was completed.</p></article>
    </div>
  </main>;
}
