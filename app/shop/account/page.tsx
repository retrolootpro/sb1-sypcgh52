import Link from 'next/link';
import { ArrowLeft, Mail, PackageSearch, UserRound } from 'lucide-react';

export default function AccountPage() {
  return <main className="commerce-page">
    <Link href="/shop" className="commerce-breadcrumbs"><ArrowLeft size={14}/> Back to shop</Link>
    <header className="commerce-page-header"><p className="commerce-kicker">CUSTOMER ACCOUNT</p><h1>Orders and support</h1><p>Pixel & Page customer accounts and complete order history will be enabled after Clover Hosted Checkout is connected to the production site.</p></header>
    <div className="commerce-page-grid">
      <article className="commerce-page-card"><PackageSearch style={{color:'#2b8b86'}}/><h3>Need help with an order?</h3><p>Use the email address from checkout and include your Clover receipt or order confirmation when contacting support.</p><Link href="/shop/pages/contact" style={{fontWeight:800,color:'#2b8b86'}}>Contact customer care</Link></article>
      <article className="commerce-page-card"><UserRound style={{color:'#2b8b86'}}/><h3>Account access is coming next</h3><p>The storefront is being structured for saved addresses, order history, favorites, and faster future checkout without exposing RetroLootPro employee accounts.</p></article>
      <article className="commerce-page-card"><Mail style={{color:'#2b8b86'}}/><h3>Purchased on another platform?</h3><p>eBay and Whatnot orders remain managed through the account and support tools on the platform where the purchase was completed.</p></article>
    </div>
  </main>;
}
