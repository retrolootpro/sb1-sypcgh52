'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Gamepad2,
  Heart,
  HelpCircle,
  MapPin,
  Menu,
  Minus,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Tag,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

type StorefrontProduct = {
  id: string;
  slug: string;
  title: string;
  category: string;
  platform: string;
  condition: string;
  price: number;
  compare_at_price?: number | null;
  quantity: number;
  featured: boolean;
  description?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  brand?: string | null;
};

type StorefrontProfile = {
  store_name: string;
  tagline: string;
  announcement: string;
  pickup_name: string;
  pickup_details: string;
  support_email?: string | null;
  phone?: string | null;
  logo_path: string;
};

const fallbackProfile: StorefrontProfile = {
  store_name: 'Pixel & Page',
  tagline: 'Every Story Has a Save Point',
  announcement: 'Fresh inventory added every week',
  pickup_name: 'Pixel & Page at Daytona Flea Market',
  pickup_details: 'Friday–Sunday. Pickup instructions are provided after checkout.',
  logo_path: '/pixel-page-logo.svg',
};

const categoryMeta: Record<string, { label: string; copy: string; icon: typeof Gamepad2 }> = {
  Games: { label: 'Video Games', copy: 'Retro cartridges, discs, and modern favorites.', icon: Gamepad2 },
  Consoles: { label: 'Consoles & Handhelds', copy: 'Tested systems ready for their next player.', icon: PackageCheck },
  Books: { label: 'Books', copy: 'BookTok favorites, special editions, and new reads.', icon: BookOpen },
  Collectibles: { label: 'Collectibles', copy: 'Controllers, figures, accessories, and display pieces.', icon: Sparkles },
};

const normalizeCategory = (value?: string | null) => {
  const text = String(value || '').toLowerCase();
  if (text.includes('book') || text.includes('media')) return 'Books';
  if (text.includes('console') || text.includes('handheld') || text.includes('system')) return 'Consoles';
  if (text.includes('collect') || text.includes('accessor') || text.includes('controller') || text.includes('figure')) return 'Collectibles';
  return 'Games';
};

export default function ShopPage() {
  const [products, setProducts] = useState<StorefrontProduct[]>([]);
  const [profile, setProfile] = useState<StorefrontProfile>(fallbackProfile);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('All');
  const [platform, setPlatform] = useState('All');
  const [sort, setSort] = useState('featured');
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [newsletterDone, setNewsletterDone] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem('pixel-page-cart');
    if (saved) {
      try { setCart(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem('pixel-page-cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [productsResult, profileResult] = await Promise.all([
        supabase.rpc('get_storefront_products', { requested_slug: 'pixel-and-page' }),
        supabase.rpc('get_storefront_profile', { requested_slug: 'pixel-and-page' }),
      ]);
      if (!active) return;
      if (!productsResult.error && productsResult.data) {
        setProducts(productsResult.data.map((item: any) => ({
          ...item,
          category: normalizeCategory(item.category),
          price: Number(item.price || 0),
          compare_at_price: item.compare_at_price ? Number(item.compare_at_price) : null,
          quantity: Number(item.quantity || 0),
          featured: Boolean(item.featured),
        })));
      }
      if (!profileResult.error && profileResult.data?.[0]) setProfile({ ...fallbackProfile, ...profileResult.data[0] });
      setLoading(false);
    };
    load();
    return () => { active = false; };
  }, []);

  const platforms = useMemo(() => ['All', ...Array.from(new Set(products.map((item) => item.platform).filter(Boolean))).slice(0, 12)], [products]);
  const featured = useMemo(() => products.filter((item) => item.featured).slice(0, 8), [products]);
  const arrivals = useMemo(() => products.slice(0, 12), [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = products.filter((product) => {
      const categoryMatch = category === 'All' || product.category === category;
      const platformMatch = platform === 'All' || product.platform === platform;
      const queryMatch = !q || `${product.title} ${product.platform} ${product.condition} ${product.brand || ''}`.toLowerCase().includes(q);
      return categoryMatch && platformMatch && queryMatch;
    });
    return [...rows].sort((a, b) => {
      if (sort === 'price-low') return a.price - b.price;
      if (sort === 'price-high') return b.price - a.price;
      if (sort === 'name') return a.title.localeCompare(b.title);
      return Number(b.featured) - Number(a.featured);
    });
  }, [products, category, platform, query, sort]);

  const cartItems = products.filter((product) => cart[product.id]);
  const cartCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * cart[item.id], 0);

  const updateCart = (product: StorefrontProduct, delta: number) => {
    setCart((current) => {
      const next = Math.max(0, Math.min(product.quantity, (current[product.id] || 0) + delta));
      const copy = { ...current };
      if (next === 0) delete copy[product.id]; else copy[product.id] = next;
      return copy;
    });
  };

  const ProductCard = ({ product }: { product: StorefrontProduct }) => (
    <article className="commerce-product-card">
      <Link href={`/shop/product/${product.slug}`} className="commerce-product-image">
        {product.featured && <span className="commerce-badge">Staff pick</span>}
        {product.compare_at_price && product.compare_at_price > product.price && <span className="commerce-sale">Sale</span>}
        {product.image_url || product.thumbnail_url ? (
          <img src={product.image_url || product.thumbnail_url || ''} alt={product.title} />
        ) : (
          <div className="commerce-placeholder"><Gamepad2 size={44}/><span>{product.category}</span></div>
        )}
      </Link>
      <div className="commerce-product-copy">
        <div className="commerce-product-meta">{product.platform || product.category}</div>
        <Link href={`/shop/product/${product.slug}`} className="commerce-product-title">{product.title}</Link>
        <div className="commerce-condition"><Check size={13}/>{product.condition || 'Available'}</div>
        <div className="commerce-product-footer">
          <div className="commerce-price"><strong>${product.price.toFixed(2)}</strong>{product.compare_at_price && product.compare_at_price > product.price && <del>${product.compare_at_price.toFixed(2)}</del>}</div>
          <button onClick={() => { updateCart(product, 1); setCartOpen(true); }} disabled={product.quantity < 1}><Plus size={16}/> Add</button>
        </div>
        {product.quantity === 1 && <small className="commerce-low-stock">Only one left</small>}
      </div>
    </article>
  );

  return (
    <main className="commerce-site" id="top">
      <div className="commerce-topbar">
        <span><Sparkles size={14}/>{profile.announcement}</span>
        <span className="commerce-topbar-wide"><Truck size={14}/> Shipping available across the U.S.</span>
        <Link href="/shop/pages/store-info"><MapPin size={14}/> Visit our Daytona shop</Link>
      </div>

      <header className="commerce-header">
        <div className="commerce-header-main">
          <button className="commerce-menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open menu"><Menu/></button>
          <Link href="/shop" className="commerce-logo"><img src="/pixel-page-logo.svg" alt={`${profile.store_name} — ${profile.tagline}`}/></Link>
          <label className="commerce-search"><Search size={20}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search games, consoles, books, collectibles…"/><button onClick={() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' })}>Search</button></label>
          <div className="commerce-header-actions">
            <Link href="/shop/pages/help"><HelpCircle/><span>Help</span></Link>
            <Link href="/shop/account"><UserRound/><span>Account</span></Link>
            <button onClick={() => setCartOpen(true)}><ShoppingBag/><span>Cart</span><b>{cartCount}</b></button>
          </div>
        </div>
        <nav className={menuOpen ? 'commerce-nav open' : 'commerce-nav'}>
          <button onClick={() => { setCategory('All'); setPlatform('All'); setMenuOpen(false); }}>Shop all</button>
          {Object.entries(categoryMeta).map(([key, item]) => <button key={key} onClick={() => { setCategory(key); setMenuOpen(false); document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' }); }}>{item.label}</button>)}
          <Link href="/shop/pages/trade-ins">Sell & trade</Link>
          <Link href="/shop/pages/store-info">Visit us</Link>
          <Link className="commerce-nav-sale" href="#catalog">New arrivals</Link>
        </nav>
      </header>

      <section className="commerce-hero">
        <div className="commerce-hero-copy">
          <p className="commerce-kicker">GAMES · BOOKS · COLLECTIBLES</p>
          <h1>Great finds.<br/><em>Real shelves.</em><br/>One local shop.</h1>
          <p>Shop live Pixel & Page inventory online, choose shipping or local pickup, and find your next save point without digging through generic marketplace listings.</p>
          <div className="commerce-hero-actions"><a href="#catalog">Shop live inventory <ArrowRight/></a><Link href="/shop/pages/trade-ins">Sell or trade yours</Link></div>
          <div className="commerce-hero-proof"><span><Check/>Live stock</span><span><Check/>Condition notes</span><span><Check/>Secure checkout</span></div>
        </div>
        <div className="commerce-hero-art">
          <img src="/pixel-page-badge.svg" alt="Pixel & Page vintage badge"/>
          <div className="commerce-floating-card commerce-floating-game"><Gamepad2/><span>Retro & modern games</span></div>
          <div className="commerce-floating-card commerce-floating-book"><BookOpen/><span>Books worth staying up for</span></div>
        </div>
      </section>

      <section className="commerce-service-strip">
        <div><Truck/><span><strong>Ship or pick up</strong><small>Choose fulfillment at checkout</small></span></div>
        <div><PackageCheck/><span><strong>Accurate inventory</strong><small>Synced from RetroLootPro</small></span></div>
        <div><ShieldCheck/><span><strong>Buy with confidence</strong><small>Photos, condition, and support</small></span></div>
        <div><Tag/><span><strong>Cash or store credit</strong><small>Trade-ins welcome in store</small></span></div>
      </section>

      <section className="commerce-section commerce-categories">
        <div className="commerce-section-heading"><div><p className="commerce-kicker">START HERE</p><h2>Shop your way</h2></div><p>Browse by what you collect, play, or read.</p></div>
        <div className="commerce-category-grid">
          {Object.entries(categoryMeta).map(([key, item]) => {
            const Icon = item.icon;
            return <button key={key} onClick={() => { setCategory(key); document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' }); }}><span><Icon/></span><strong>{item.label}</strong><p>{item.copy}</p><em>Shop now <ArrowRight/></em></button>;
          })}
        </div>
      </section>

      {featured.length > 0 && <section className="commerce-section commerce-featured">
        <div className="commerce-section-heading"><div><p className="commerce-kicker">CURATED BY PIXEL & PAGE</p><h2>Featured finds</h2></div><a href="#catalog">View all <ArrowRight/></a></div>
        <div className="commerce-product-row">{featured.map((product) => <ProductCard key={product.id} product={product}/>)}</div>
      </section>}

      <section className="commerce-split-promo">
        <div className="commerce-promo-copy"><p className="commerce-kicker">BOOK PEOPLE, THIS ONE IS FOR YOU</p><h2>Fresh reads without the big-box feel.</h2><p>Find popular romance, fantasy, thrillers, special editions, and the books everyone keeps talking about.</p><button onClick={() => { setCategory('Books'); document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' }); }}>Shop books <ArrowRight/></button></div>
        <div className="commerce-promo-visual"><BookOpen size={120}/><img src="/pixel-page-badge.svg" alt=""/></div>
      </section>

      <section className="commerce-section commerce-platforms">
        <div className="commerce-section-heading"><div><p className="commerce-kicker">BROWSE BY PLATFORM</p><h2>Pick your player</h2></div></div>
        <div className="commerce-platform-grid">{platforms.filter((item) => item !== 'All').slice(0, 8).map((item) => <button key={item} onClick={() => { setCategory('All'); setPlatform(item); document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' }); }}><Gamepad2/><span>{item}</span></button>)}</div>
      </section>

      <section className="commerce-section commerce-catalog" id="catalog">
        <div className="commerce-section-heading"><div><p className="commerce-kicker">LIVE INVENTORY</p><h2>{category === 'All' ? 'Shop everything' : categoryMeta[category]?.label || category}</h2></div><p>{filtered.length} item{filtered.length === 1 ? '' : 's'} available now</p></div>
        <div className="commerce-toolbar">
          <div className="commerce-filter-group">
            <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>All</option>{Object.keys(categoryMeta).map((item) => <option key={item}>{item}</option>)}</select><ChevronDown/></label>
            <label>Platform<select value={platform} onChange={(event) => setPlatform(event.target.value)}>{platforms.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown/></label>
          </div>
          <label className="commerce-sort">Sort by<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Featured</option><option value="price-low">Price: Low to high</option><option value="price-high">Price: High to low</option><option value="name">Name</option></select><ChevronDown/></label>
        </div>
        {loading ? <div className="commerce-empty"><Clock3 className="commerce-spin"/><h3>Loading the shelves…</h3></div> : filtered.length > 0 ? <div className="commerce-product-grid">{filtered.map((product) => <ProductCard key={product.id} product={product}/>)}</div> : <div className="commerce-empty"><Search/><h3>No matches found</h3><p>Try another category, platform, or search.</p><button onClick={() => { setCategory('All'); setPlatform('All'); setQuery(''); }}>Clear filters</button></div>}
      </section>

      <section className="commerce-trade-banner">
        <div><p className="commerce-kicker">SELL OR TRADE</p><h2>Your old favorites can fund your next ones.</h2><p>Bring in games, consoles, books, and collectibles. Choose cash or receive more value in store credit.</p><Link href="/shop/pages/trade-ins">See how trade-ins work <ArrowRight/></Link></div>
        <div className="commerce-trade-steps"><span>1<strong>Bring it in</strong></span><ArrowRight/><span>2<strong>Get an offer</strong></span><ArrowRight/><span>3<strong>Cash or credit</strong></span></div>
      </section>

      <section className="commerce-section commerce-store-card">
        <div className="commerce-store-map"><MapPin size={48}/><span>DAYTONA</span></div>
        <div><p className="commerce-kicker">SHOP IN PERSON</p><h2>{profile.pickup_name}</h2><p>{profile.pickup_details}</p><div className="commerce-store-facts"><span><Store/>Daytona Flea Market</span><span><Clock3/>Friday–Sunday</span><span><PackageCheck/>Online pickup available</span></div><Link href="/shop/pages/store-info">Store details and directions <ArrowRight/></Link></div>
      </section>

      <section className="commerce-newsletter">
        <img src="/pixel-page-badge.svg" alt=""/>
        <div><p className="commerce-kicker">DON'T MISS THE NEXT DROP</p><h2>New inventory, show reminders, and store updates.</h2><p>No generic spam. Just the good stuff.</p></div>
        <form onSubmit={(event) => { event.preventDefault(); if (newsletterEmail) setNewsletterDone(true); }}><input type="email" value={newsletterEmail} onChange={(event) => setNewsletterEmail(event.target.value)} placeholder="Email address" required/><button>{newsletterDone ? 'You’re in!' : 'Sign me up'}<ArrowRight/></button></form>
      </section>

      <footer className="commerce-footer">
        <div className="commerce-footer-brand"><img src="/pixel-page-logo.svg" alt={profile.store_name}/><p>Games, books, and collectibles for every kind of player and reader.</p><span>{profile.tagline}</span></div>
        <div><strong>Shop</strong><a href="#catalog">All products</a><button onClick={() => setCategory('Games')}>Video games</button><button onClick={() => setCategory('Consoles')}>Consoles</button><button onClick={() => setCategory('Books')}>Books</button><button onClick={() => setCategory('Collectibles')}>Collectibles</button></div>
        <div><strong>Customer care</strong><Link href="/shop/pages/shipping">Shipping & pickup</Link><Link href="/shop/pages/returns">Returns</Link><Link href="/shop/pages/faq">FAQ</Link><Link href="/shop/pages/contact">Contact us</Link><Link href="/shop/pages/trade-ins">Trade-ins</Link></div>
        <div><strong>About</strong><Link href="/shop/pages/our-story">Our story</Link><Link href="/shop/pages/store-info">Visit the store</Link><Link href="/shop/pages/privacy">Privacy</Link><Link href="/shop/pages/terms">Terms</Link></div>
        <div className="commerce-footer-bottom"><span>© {new Date().getFullYear()} Pixel & Page, LLC</span><span>Every Story Has a Save Point.</span></div>
      </footer>

      {cartOpen && <div className="commerce-cart-overlay" onClick={() => setCartOpen(false)}/>} 
      <aside className={cartOpen ? 'commerce-cart open' : 'commerce-cart'}>
        <div className="commerce-cart-header"><div><p className="commerce-kicker">YOUR CART</p><h2>{cartCount} item{cartCount === 1 ? '' : 's'}</h2></div><button onClick={() => setCartOpen(false)}><X/></button></div>
        <div className="commerce-cart-items">
          {cartItems.length === 0 ? <div className="commerce-cart-empty"><ShoppingBag/><h3>Your cart is empty</h3><p>There is plenty waiting on the shelves.</p><button onClick={() => setCartOpen(false)}>Continue shopping</button></div> : cartItems.map((item) => <div className="commerce-cart-line" key={item.id}><div className="commerce-cart-thumb">{item.thumbnail_url || item.image_url ? <img src={item.thumbnail_url || item.image_url || ''} alt=""/> : <Gamepad2/>}</div><div><Link href={`/shop/product/${item.slug}`}>{item.title}</Link><small>{item.condition}</small><div className="commerce-cart-qty"><button onClick={() => updateCart(item, -1)}><Minus/></button><b>{cart[item.id]}</b><button onClick={() => updateCart(item, 1)}><Plus/></button></div></div><strong>${(item.price * cart[item.id]).toFixed(2)}</strong></div>)}
        </div>
        {cartItems.length > 0 && <div className="commerce-cart-footer"><div><span>Subtotal</span><strong>${subtotal.toFixed(2)}</strong></div><p>Shipping, pickup, and taxes are calculated at checkout.</p><Link href="/shop/checkout" onClick={() => setCartOpen(false)}>Checkout securely <ArrowRight/></Link><small><ShieldCheck/>Secure checkout powered by Clover</small></div>}
      </aside>
    </main>
  );
}
