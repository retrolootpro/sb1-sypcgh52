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

type Product = {
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

type Profile = {
  store_name: string;
  tagline: string;
  announcement: string;
  pickup_name: string;
  pickup_details: string;
  support_email?: string | null;
  logo_path?: string | null;
};

const fallbackProfile: Profile = {
  store_name: 'Pixel & Page',
  tagline: 'Every Story Has a Save Point',
  announcement: 'Fresh inventory added every week',
  pickup_name: 'Pixel & Page at Daytona Flea Market',
  pickup_details: 'Friday-Sunday. Pickup instructions are provided after checkout.',
  logo_path: '/pixel-page-logo.svg',
};

const categories = [
  { key: 'Games', label: 'Video Games', copy: 'Retro cartridges, discs, and modern favorites.', icon: Gamepad2 },
  { key: 'Consoles', label: 'Consoles & Handhelds', copy: 'Tested systems ready for their next player.', icon: PackageCheck },
  { key: 'Books', label: 'Books', copy: 'BookTok favorites, special editions, and new reads.', icon: BookOpen },
  { key: 'Collectibles', label: 'Collectibles', copy: 'Controllers, figures, accessories, and display pieces.', icon: Sparkles },
];

export default function StorefrontClient() {
  const [products, setProducts] = useState<Product[]>([]);
  const [profile, setProfile] = useState<Profile>(fallbackProfile);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [category, setCategory] = useState('All');
  const [platform, setPlatform] = useState('All');
  const [sort, setSort] = useState('featured');
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('pixel-page-cart');
      if (saved) setCart(JSON.parse(saved));
    } catch {
      setCart({});
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem('pixel-page-cart', JSON.stringify(cart));
  }, [cart]);

  const loadCatalog = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/storefront/catalog', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Catalog could not be loaded.');
      setProducts((result.products || []).map((item: Product) => ({
        ...item,
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 0),
        featured: Boolean(item.featured),
      })));
      setProfile({ ...fallbackProfile, ...(result.profile || {}) });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Catalog could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCatalog(); }, []);

  const platformOptions = useMemo(() => ['All', ...Array.from(new Set(products.map((item) => item.platform).filter(Boolean))).slice(0, 16)], [products]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = products.filter((item) => {
      const categoryMatch = category === 'All' || item.category === category;
      const platformMatch = platform === 'All' || item.platform === platform;
      const searchMatch = !q || `${item.title} ${item.platform} ${item.condition} ${item.brand || ''}`.toLowerCase().includes(q);
      return categoryMatch && platformMatch && searchMatch;
    });
    return [...rows].sort((a, b) => {
      if (sort === 'price-low') return a.price - b.price;
      if (sort === 'price-high') return b.price - a.price;
      if (sort === 'name') return a.title.localeCompare(b.title);
      return Number(b.featured) - Number(a.featured);
    });
  }, [products, category, platform, query, sort]);

  const cartItems = products.filter((item) => cart[item.id]);
  const cartCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * cart[item.id], 0);

  const updateCart = (item: Product, change: number) => {
    setCart((current) => {
      const quantity = Math.max(0, Math.min(item.quantity, (current[item.id] || 0) + change));
      const next = { ...current };
      if (!quantity) delete next[item.id]; else next[item.id] = quantity;
      return next;
    });
  };

  const showCategory = (value: string, platformValue = 'All') => {
    setCategory(value);
    setPlatform(platformValue);
    setMenuOpen(false);
    window.setTimeout(() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const ProductCard = ({ item }: { item: Product }) => (
    <article className="commerce-product-card">
      <Link href={`/shop/product/${item.slug}`} className="commerce-product-image">
        {item.featured && <span className="commerce-badge">Staff pick</span>}
        {item.image_url || item.thumbnail_url
          ? <img src={item.image_url || item.thumbnail_url || ''} alt={item.title}/>
          : <div className="commerce-placeholder"><Gamepad2/><span>{item.category}</span></div>}
      </Link>
      <div className="commerce-product-copy">
        <div className="commerce-product-meta">{item.platform || item.category}</div>
        <Link href={`/shop/product/${item.slug}`} className="commerce-product-title">{item.title}</Link>
        <div className="commerce-condition"><Check/>{item.condition}</div>
        <div className="commerce-product-footer">
          <div className="commerce-price"><strong>${item.price.toFixed(2)}</strong>{item.compare_at_price && item.compare_at_price > item.price ? <del>${item.compare_at_price.toFixed(2)}</del> : null}</div>
          <button type="button" onClick={() => { updateCart(item, 1); setCartOpen(true); }} disabled={!item.quantity}><Plus/>Add</button>
        </div>
        {item.quantity === 1 && <small className="commerce-low-stock">Only one left</small>}
      </div>
    </article>
  );

  return (
    <main className="commerce-site" id="top">
      <div className="commerce-topbar">
        <span><Sparkles/>{profile.announcement}</span>
        <span className="commerce-topbar-wide"><Truck/>Shipping available across the U.S.</span>
        <Link href="/shop/pages/store-info"><MapPin/>Visit our Daytona shop</Link>
      </div>

      <header className="commerce-header">
        <div className="commerce-header-main">
          <button type="button" className="commerce-menu-button" onClick={() => setMenuOpen((open) => !open)} aria-label="Open menu"><Menu/></button>
          <Link href="/shop" className="commerce-logo"><img src={profile.logo_path || '/pixel-page-logo.svg'} alt={`${profile.store_name} - ${profile.tagline}`}/></Link>
          <label className="commerce-search"><Search/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search games, consoles, books, collectibles"/><button type="button" onClick={() => showCategory(category, platform)}>Search</button></label>
          <div className="commerce-header-actions">
            <Link href="/shop/pages/help"><HelpCircle/><span>Help</span></Link>
            <Link href="/shop/account"><UserRound/><span>Account</span></Link>
            <button type="button" onClick={() => setCartOpen(true)}><ShoppingBag/><span>Cart</span><b>{cartCount}</b></button>
          </div>
        </div>
        <nav className={menuOpen ? 'commerce-nav open' : 'commerce-nav'}>
          <button type="button" onClick={() => showCategory('All')}>Shop all</button>
          {categories.map((item) => <button type="button" key={item.key} onClick={() => showCategory(item.key)}>{item.label}</button>)}
          <Link href="/shop/pages/trade-ins" onClick={() => setMenuOpen(false)}>Sell & trade</Link>
          <Link href="/shop/pages/store-info" onClick={() => setMenuOpen(false)}>Visit us</Link>
        </nav>
      </header>

      <section className="commerce-hero">
        <div className="commerce-hero-copy">
          <p className="commerce-kicker">GAMES - BOOKS - COLLECTIBLES</p>
          <h1>Great finds.<br/><em>Real shelves.</em><br/>One local shop.</h1>
          <p>Shop live Pixel & Page inventory online with clear condition notes, real photos, shipping, and local pickup.</p>
          <div className="commerce-hero-actions"><button type="button" onClick={() => showCategory('All')}>Shop live inventory <ArrowRight/></button><Link href="/shop/pages/trade-ins">Sell or trade yours</Link></div>
          <div className="commerce-hero-proof"><span><Check/>Live stock</span><span><Check/>Condition notes</span><span><Check/>Secure checkout</span></div>
        </div>
        <div className="commerce-hero-art"><img src="/pixel-page-badge.svg" alt="Pixel & Page badge"/></div>
      </section>

      <section className="commerce-service-strip">
        <div><Truck/><span><strong>Ship or pick up</strong><small>Choose fulfillment at checkout</small></span></div>
        <div><PackageCheck/><span><strong>Live inventory</strong><small>Read directly from RetroLootPro</small></span></div>
        <div><ShieldCheck/><span><strong>Buy with confidence</strong><small>Photos, condition, and support</small></span></div>
        <div><Tag/><span><strong>Cash or store credit</strong><small>Trade-ins welcome in store</small></span></div>
      </section>

      <section className="commerce-section commerce-categories">
        <div className="commerce-section-heading"><div><p className="commerce-kicker">START HERE</p><h2>Shop your way</h2></div><p>Browse by what you collect, play, or read.</p></div>
        <div className="commerce-category-grid">
          {categories.map((item) => { const Icon = item.icon; return <button type="button" key={item.key} onClick={() => showCategory(item.key)}><span><Icon/></span><strong>{item.label}</strong><p>{item.copy}</p><em>Shop now <ArrowRight/></em></button>; })}
        </div>
      </section>

      <section className="commerce-section commerce-platforms">
        <div className="commerce-section-heading"><div><p className="commerce-kicker">BROWSE BY PLATFORM</p><h2>Find your system</h2></div></div>
        <div className="commerce-platform-grid">{platformOptions.filter((item) => item !== 'All').map((item) => <button type="button" key={item} onClick={() => showCategory('All', item)}><Gamepad2/><span>{item}</span></button>)}</div>
      </section>

      <section className="commerce-section commerce-catalog" id="catalog">
        <div className="commerce-section-heading"><div><p className="commerce-kicker">LIVE INVENTORY</p><h2>{category === 'All' ? 'Shop everything' : categories.find((item) => item.key === category)?.label || category}</h2></div><p>{filtered.length} item{filtered.length === 1 ? '' : 's'} available now</p></div>
        <div className="commerce-toolbar">
          <div className="commerce-filter-group">
            <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="All">All</option>{categories.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select><ChevronDown/></label>
            <label>Platform<select value={platform} onChange={(event) => setPlatform(event.target.value)}>{platformOptions.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown/></label>
          </div>
          <label className="commerce-sort">Sort by<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Featured</option><option value="price-low">Price: Low to high</option><option value="price-high">Price: High to low</option><option value="name">Name</option></select><ChevronDown/></label>
        </div>
        {loading ? <div className="commerce-empty"><Clock3 className="commerce-spin"/><h3>Loading the shelves...</h3></div>
          : loadError ? <div className="commerce-empty commerce-error"><h3>Inventory could not load</h3><p>{loadError}</p><button type="button" onClick={loadCatalog}>Try again</button></div>
          : filtered.length ? <div className="commerce-product-grid">{filtered.map((item) => <ProductCard item={item} key={item.id}/>)}</div>
          : <div className="commerce-empty"><Search/><h3>No matching inventory</h3><p>Try clearing the filters or publish prices in RetroLootPro.</p><button type="button" onClick={() => { setCategory('All'); setPlatform('All'); setQuery(''); }}>Clear filters</button></div>}
      </section>

      <section className="commerce-trade-banner"><div><p className="commerce-kicker">SELL OR TRADE</p><h2>Your old favorites can fund your next ones.</h2><p>Bring in games, consoles, books, and collectibles. Choose cash or receive more value in store credit.</p><Link href="/shop/pages/trade-ins">See how trade-ins work <ArrowRight/></Link></div></section>

      <section className="commerce-section commerce-store-card"><div className="commerce-store-map"><MapPin/><span>DAYTONA</span></div><div><p className="commerce-kicker">SHOP IN PERSON</p><h2>{profile.pickup_name}</h2><p>{profile.pickup_details}</p><div className="commerce-store-facts"><span><Store/>Daytona Flea Market</span><span><Clock3/>Friday-Sunday</span><span><PackageCheck/>Online pickup available</span></div><Link href="/shop/pages/store-info">Store details and directions <ArrowRight/></Link></div></section>

      <footer className="commerce-footer">
        <div className="commerce-footer-brand"><img src={profile.logo_path || '/pixel-page-logo.svg'} alt={profile.store_name}/><p>Games, books, and collectibles for every kind of player and reader.</p><span>{profile.tagline}</span></div>
        <div><strong>Shop</strong><button type="button" onClick={() => showCategory('All')}>All products</button>{categories.map((item) => <button type="button" key={item.key} onClick={() => showCategory(item.key)}>{item.label}</button>)}</div>
        <div><strong>Customer care</strong><Link href="/shop/pages/shipping">Shipping & pickup</Link><Link href="/shop/pages/returns">Returns</Link><Link href="/shop/pages/faq">FAQ</Link><Link href="/shop/pages/contact">Contact us</Link></div>
        <div><strong>About</strong><Link href="/shop/pages/our-story">Our story</Link><Link href="/shop/pages/store-info">Visit the store</Link><Link href="/shop/pages/privacy">Privacy</Link><Link href="/shop/pages/terms">Terms</Link></div>
        <div className="commerce-footer-bottom"><span>© {new Date().getFullYear()} Pixel & Page, LLC</span><span>{profile.tagline}</span></div>
      </footer>

      {cartOpen && <button className="commerce-cart-overlay" onClick={() => setCartOpen(false)} aria-label="Close cart"/>}
      <aside className={cartOpen ? 'commerce-cart open' : 'commerce-cart'}>
        <div className="commerce-cart-header"><div><p className="commerce-kicker">YOUR CART</p><h2>{cartCount} item{cartCount === 1 ? '' : 's'}</h2></div><button type="button" onClick={() => setCartOpen(false)}><X/></button></div>
        <div className="commerce-cart-items">
          {!cartItems.length ? <div className="commerce-cart-empty"><ShoppingBag/><h3>Your cart is empty</h3><button type="button" onClick={() => setCartOpen(false)}>Continue shopping</button></div> : cartItems.map((item) => <div className="commerce-cart-line" key={item.id}><div className="commerce-cart-thumb">{item.thumbnail_url || item.image_url ? <img src={item.thumbnail_url || item.image_url || ''} alt=""/> : <Gamepad2/>}</div><div><Link href={`/shop/product/${item.slug}`}>{item.title}</Link><small>{item.condition}</small><div className="commerce-cart-qty"><button type="button" onClick={() => updateCart(item, -1)}><Minus/></button><b>{cart[item.id]}</b><button type="button" onClick={() => updateCart(item, 1)}><Plus/></button></div></div><strong>${(item.price * cart[item.id]).toFixed(2)}</strong></div>)}
        </div>
        {cartItems.length > 0 && <div className="commerce-cart-footer"><div><span>Subtotal</span><strong>${subtotal.toFixed(2)}</strong></div><p>Shipping, pickup, and taxes are calculated at checkout.</p><Link href="/shop/checkout" onClick={() => setCartOpen(false)}>Checkout securely <ArrowRight/></Link><small><ShieldCheck/>Secure checkout powered by Clover</small></div>}
      </aside>
    </main>
  );
}
