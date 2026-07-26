'use client';

import Link from 'next/link';
import { CheckCircle2, PackageCheck, ShoppingBag } from 'lucide-react';
import { useEffect } from 'react';

export default function CheckoutSuccessPage() {
  useEffect(() => {
    window.localStorage.removeItem('pixel-page-cart');
  }, []);

  return <main className="commerce-page" style={{textAlign:'center',maxWidth:760}}>
    <CheckCircle2 size={68} style={{color:'#2b8b86',marginBottom:20}}/>
    <p className="commerce-kicker">PAYMENT RECEIVED</p>
    <h1>Thanks for shopping Pixel & Page.</h1>
    <p>Your Clover payment was completed. Keep the receipt sent to your email. Shipping or pickup updates will follow using the contact information provided during checkout.</p>
    <div className="commerce-page-grid" style={{marginTop:35,textAlign:'left'}}>
      <article className="commerce-page-card"><PackageCheck style={{color:'#2b8b86'}}/><h3>What happens next</h3><p>Your order is reviewed against the live inventory record and prepared for the fulfillment method selected at checkout.</p></article>
      <article className="commerce-page-card"><ShoppingBag style={{color:'#2b8b86'}}/><h3>Keep browsing</h3><p>New games, books, consoles, and collectibles are published regularly.</p><Link href="/shop" style={{fontWeight:850,color:'#2b8b86'}}>Return to the shop</Link></article>
    </div>
  </main>;
}
