'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, Search, ShoppingBag, Truck, X } from 'lucide-react';

const categories = ['Games','Books','Collectibles','Consoles','Accessories','Apparel'];

export default function ShopFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (pathname === '/shop') return children;
  return <div className="commerce-site commerce-reference reference-inner">
    <div className="commerce-topbar"><span><Truck/>Online only · Shipping to your door</span><div><Link href="/shop/request">Request an item</Link><Link href="/shop/pages/help">Help</Link><Link href="/shop/pages/contact">Contact</Link></div></div>
    <header className="commerce-header">
      <div className="commerce-header-main">
        <button type="button" className="commerce-menu-button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="inner-shop-nav" onClick={() => setOpen(!open)}>{open ? <X/> : <Menu/>}</button>
        <Link href="/shop" className="commerce-logo" onClick={() => setOpen(false)}><Image src="/storefront/pixel-page-wordmark.png" width={265} height={53} alt="Pixel & Page - Every Story Has a Save Point" priority unoptimized/></Link>
        <form action="/shop" className="commerce-search" role="search"><Search/><input name="q" aria-label="Search products" placeholder="Search games, books, collectibles and more..."/><button aria-label="Search" type="submit"><Search/></button></form>
        <div className="commerce-header-actions"><Link href="/shop/request">Request an item</Link><Link href="/shop/checkout" aria-label="Cart and checkout"><ShoppingBag/><span>Cart</span></Link></div>
      </div>
      <nav id="inner-shop-nav" className={open ? 'commerce-nav open' : 'commerce-nav'} aria-label="Shop categories" onClick={() => setOpen(false)}>
        <Link href="/shop" className="reference-home">Home</Link>
        {categories.map((category) => <Link href={`/shop?category=${category}#catalog`} key={category}>{category}</Link>)}
        <Link href="/shop/request">Request an item</Link>
      </nav>
    </header>
    <div className="reference-page-content">{children}</div>
    <footer className="commerce-footer">
      <div className="commerce-footer-brand"><Image src="/pixel-page-badge.webp" alt="Pixel & Page" width={120} height={120} unoptimized/><span>Every Story Has a Save Point</span></div>
      <div><strong>Shop</strong><Link href="/shop#catalog">All products</Link><Link href="/shop/request">Request an item</Link><Link href="/shop/checkout">Cart & checkout</Link></div>
      <div><strong>Customer care</strong><Link href="/shop/pages/shipping">Shipping</Link><Link href="/shop/pages/returns">Returns</Link><Link href="/shop/pages/faq">FAQ</Link><Link href="/shop/pages/contact">Contact us</Link></div>
      <div><strong>About</strong><Link href="/shop/pages/our-story">Our story</Link><Link href="/shop/pages/privacy">Privacy</Link><Link href="/shop/pages/terms">Terms</Link></div>
      <div className="reference-footer-contact"><strong>Let&apos;s find your next favorite</strong><p>Online only. Games, books, and collectibles shipped to your door.</p><a href="mailto:support@pixelandpagellc.com">Email customer support</a></div>
      <div className="commerce-footer-bottom"><span>© {new Date().getFullYear()} Pixel & Page, LLC</span><span>Play. Read. Collect. Repeat.</span></div>
    </footer>
  </div>;
}
