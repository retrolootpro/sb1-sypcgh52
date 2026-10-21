'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseSavedCart } from '@/lib/storefront-model';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clock3,
  Gamepad2,
  Heart,
  Menu,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  ShoppingCart,
  ShoppingBag,
  Truck,
  UserRound,
  Users,
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
  announcement: 'Online only - Shipping to your door',
  pickup_name: '',
  pickup_details: '',
  support_email: 'support@pixelandpagellc.com',
  logo_path: '/pixel-page-logo.svg',
};

const categories = [
  { key: 'Games', label: 'Video Games', art: 'games' },
  { key: 'Books', label: 'Books', art: 'books' },
  { key: 'Collectibles', label: 'Collectibles', art: 'collectibles' },
  { key: 'Consoles', label: 'Consoles', art: 'consoles' },
  { key: 'Accessories', label: 'Accessories', art: 'accessories' },
  { key: 'Apparel', label: 'Apparel', art: 'apparel' },
  { key: 'All', label: 'More', art: 'more' },
];

const heroSlides = [
  { title: <>Retro Games.<br/>Great Reads.<br/><em>Good Finds.</em></>, label: 'Retro Games. Great Reads. Good Finds.', copy: 'Games, books, collectibles, apparel, and more for gamers, readers, and kindred spirits.', category: 'All', button: 'Shop All Products', art: 'hero-shelves', thumbnail: 'hero-shelves' },
  { title: <>Level up<br/>your next<br/><em>adventure.</em></>, label: 'Games, consoles & hidden gems.', copy: 'Find your next favorite game, revisit a classic, or discover something unexpected on our shelves.', category: 'Games', button: 'Shop Video Games', art: 'games-shelves', thumbnail: 'imports' },
  { title: <>One more<br/>chapter.<br/><em>One great find.</em></>, label: 'Books & page-turning reads.', copy: 'Your next great read is waiting. Browse the books available from our real local shelves.', category: 'Books', button: 'Shop Books', art: 'book-shelves', thumbnail: 'book-shelves' },
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
  const [cartLoaded, setCartLoaded] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const [catalogOpen, setCatalogOpen] = useState(false);

  useEffect(() => {
    const syncCatalog = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.has('q')) { setQuery(params.get('q') || ''); setCategory('All'); setCatalogOpen(true); }
      if (categories.some((item) => item.key === params.get('category'))) {
        setCategory(params.get('category')!); setQuery(''); setCatalogOpen(true);
      }
      if (window.location.hash === '#catalog') setCatalogOpen(true);
    };
    syncCatalog();
    window.addEventListener('hashchange', syncCatalog);
    window.addEventListener('popstate', syncCatalog);
    return () => { window.removeEventListener('hashchange', syncCatalog); window.removeEventListener('popstate', syncCatalog); };
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('pixel-page-cart');
      setCart(parseSavedCart(saved));
    } catch (error) {
      console.error('Cart could not be restored:', error);
      setLoadError('Your saved cart could not be restored. Please open checkout to clear it.');
    }
    setCartLoaded(true);
  }, []);

  useEffect(() => {
    if (!cartLoaded) return;
    try { window.localStorage.setItem('pixel-page-cart', JSON.stringify(cart)); }
    catch (error) { console.error('Cart storage:', error); setLoadError('Your browser is blocking cart storage. Enable site storage before shopping.'); }
  }, [cart, cartLoaded]);

  const loadCatalog = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    loadCatalog();
    const refresh = () => { if (document.visibilityState === 'visible') loadCatalog(); };
    const interval = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, [loadCatalog]);

  const platformOptions = useMemo(() => ['All', ...Array.from(new Set(products.map((item) => item.platform).filter(Boolean))).slice(0, 16)], [products]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = products.filter((item) => {
      const categoryMatch = category === 'All' || item.category === category
        || (category === 'Accessories' && /accessor|controller|headset|cable|adapter|charger|memory card/i.test(`${item.title} ${item.category}`))
        || (category === 'Apparel' && /apparel|hoodie|t-shirt|tee shirt|sweatshirt|clothing/i.test(`${item.title} ${item.category}`));
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
      const quantity = Math.max(0, Math.min(20, item.quantity, (current[item.id] || 0) + change));
      const next = { ...current };
      if (!quantity) delete next[item.id]; else next[item.id] = quantity;
      return next;
    });
  };

  const showCategory = (value: string, platformValue = 'All') => {
    setCategory(value);
    setPlatform(platformValue);
    setMenuOpen(false);
    setQuery('');
    setCatalogOpen(true);
    window.history.replaceState(null, '', `/shop?category=${encodeURIComponent(value)}#catalog`);
    window.setTimeout(() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const ProductCard = ({ item }: { item: Product }) => (
    <article className="commerce-product-card">
      <Link href={`/shop/product/${item.slug}`} className="commerce-product-image">
        {item.featured && <span className="commerce-badge">Staff pick</span>}
        {item.image_url || item.thumbnail_url
          ? <Image src={item.image_url || item.thumbnail_url || ''} alt={item.title} width={220} height={160} unoptimized/>
          : <div className="commerce-placeholder"><Gamepad2/><span>{item.category}</span></div>}
      </Link>
      <div className="commerce-product-copy">
        <div className="commerce-price"><strong>${item.price.toFixed(2)}</strong>{item.compare_at_price && item.compare_at_price > item.price ? <del>${item.compare_at_price.toFixed(2)}</del> : null}</div>
        <div className="commerce-product-meta">{item.platform || item.category}</div>
        <Link href={`/shop/product/${item.slug}`} className="commerce-product-title">{item.title}</Link>
        <div className="commerce-condition"><Check/>{item.condition}</div>
        <div className="commerce-product-footer">
          <button type="button" aria-label={`Add ${item.title} to cart`} onClick={() => { updateCart(item, 1); setCartOpen(true); }} disabled={!item.quantity}><ShoppingCart/></button>
        </div>
        {item.quantity === 1 && <small className="commerce-low-stock">Only one left</small>}
      </div>
    </article>
  );

  return (
    <main className="commerce-site commerce-reference" id="top">
      <div className="commerce-topbar">
        <span><Truck/>{profile.announcement}</span>
        <div><Link href="/shop/account">Purchase support</Link><Link href="/shop/pages/help">Help</Link><Link href="/shop/pages/contact">Contact</Link></div>
      </div>

      <header className="commerce-header">
        <div className="commerce-header-main">
          <button type="button" className="commerce-menu-button" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="shop-navigation"><Menu/></button>
          <Link href="/shop" className="commerce-logo"><Image src="/storefront/pixel-page-wordmark.png" width={265} height={53} alt={`${profile.store_name} - ${profile.tagline}`} priority unoptimized/></Link>
          <form className="commerce-search" role="search" onSubmit={(event) => { event.preventDefault(); setCatalogOpen(true); setMenuOpen(false); window.setTimeout(() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' }), 0); }}><Search/><input aria-label="Search products" value={query} onChange={(event) => { setQuery(event.target.value); if (event.target.value) setCatalogOpen(true); }} placeholder="Search games, books, collectibles and more..."/><button type="submit" aria-label="Search"><Search/></button></form>
          <div className="commerce-header-actions">
            <Link href="/shop/account" aria-label="Account"><UserRound/><span>Account</span></Link>
            <Link href="/shop/pages/help" aria-label="Customer care"><Heart/><span>Customer care</span></Link>
            <button type="button" aria-label={`Open cart, ${cartCount} items`} onClick={() => setCartOpen(true)}><ShoppingBag/><span>Cart</span><b>{cartCount}</b></button>
          </div>
        </div>
        <nav id="shop-navigation" aria-label="Shop categories" className={menuOpen ? 'commerce-nav open' : 'commerce-nav'}>
          <button type="button" className="reference-home" onClick={() => { setCatalogOpen(false); setQuery(''); setMenuOpen(false); window.history.replaceState(null, '', '/shop'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Home</button>
          {categories.map((item) => <button type="button" key={item.key} onClick={() => showCategory(item.key)}>{item.key === 'Games' ? 'Games' : item.label}<ChevronDown/></button>)}
          <Link className="reference-trade-link" href="/shop/request" onClick={() => setMenuOpen(false)}>Request an item</Link>
        </nav>
      </header>

      <section className="commerce-hero" aria-label="Store highlights" aria-roledescription="carousel">
        <Image className="reference-hero-photo" src={`/storefront/${heroSlides[activeSlide].art}.png`} alt="" width={770} height={225} priority unoptimized/>
        <div className="commerce-hero-copy">
          <h1>{heroSlides[activeSlide].title}</h1>
          <p>{heroSlides[activeSlide].copy}</p>
          <div className="commerce-hero-actions"><button type="button" onClick={() => showCategory(heroSlides[activeSlide].category)}>{heroSlides[activeSlide].button}<ArrowRight/></button></div>
        </div>
        <button type="button" className="reference-slide-arrow previous" aria-label="Previous highlight" onClick={() => setActiveSlide((activeSlide + heroSlides.length - 1) % heroSlides.length)}><ChevronLeft/></button>
        <button type="button" className="reference-slide-arrow next" aria-label="Next highlight" onClick={() => setActiveSlide((activeSlide + 1) % heroSlides.length)}><ChevronRight/></button>
        <div className="reference-slide-dots">{heroSlides.map((slide, index) => <button type="button" key={slide.label} aria-label={`Show highlight ${index + 1}`} aria-pressed={index === activeSlide} onClick={() => setActiveSlide(index)}/>)}</div>
      </section>

      <div className="reference-highlights">{heroSlides.map((slide, index) => <button type="button" key={slide.label} aria-pressed={index === activeSlide} onClick={() => setActiveSlide(index)}><Image src={`/storefront/${slide.thumbnail}.png`} alt="" width={140} height={52} unoptimized/><strong>{slide.label}</strong><span>0{index + 1}</span></button>)}</div>

      <section className="commerce-section commerce-categories" aria-label="Browse categories">
        <div className="commerce-category-grid">
          {categories.map((item) => <button type="button" key={item.key} className={`reference-category-${item.art}`} onClick={() => showCategory(item.key)}><Image src={`/storefront/category-${item.art}.png`} alt="" width={88} height={63} unoptimized/><strong>{item.label}</strong></button>)}
        </div>
      </section>

      {!catalogOpen && <section className="commerce-section reference-featured" aria-label="Featured finds">
        <div className="commerce-section-heading"><h2>Featured Finds</h2><span className="reference-heading-rule"/><button type="button" onClick={() => showCategory('All')}>View All <ArrowRight/></button></div>
        {loading ? <div className="commerce-empty" role="status"><Clock3 className="commerce-spin"/><h3>Loading the shelves...</h3></div>
          : loadError ? <div className="commerce-empty commerce-error" role="alert"><h3>Inventory could not load</h3><p>{loadError}</p><button type="button" onClick={loadCatalog}>Try again</button></div>
          : products.length ? <div className="commerce-product-grid">{[...products].sort((a, b) => Number(b.featured) - Number(a.featured)).slice(0, 6).map((item) => <ProductCard item={item} key={item.id}/>)}</div>
          : <div className="commerce-empty"><h3>The shelves are being refreshed.</h3><p>Please check back or contact the store for availability.</p></div>}
      </section>}

      <section className="commerce-service-strip" aria-label="Why shop Pixel and Page">
        <div><Truck/><span><strong>Online only</strong><small>Shipping to your door</small></span></div>
        <div><Heart/><span><strong>Carefully curated</strong><small>Find your next favorite</small></span></div>
        <div><Gamepad2/><span><strong>Looking for a favorite?</strong><small><Link href="/shop/request">Request an item</Link></small></span></div>
        <div><Users/><span><strong>Support small business</strong><small>Thanks for being here</small></span></div>
      </section>

      {catalogOpen && <section className="commerce-section commerce-catalog" id="catalog" tabIndex={-1}>
        <div className="commerce-section-heading"><div><p className="commerce-kicker">LIVE INVENTORY</p><h2>{category === 'All' ? 'Shop everything' : categories.find((item) => item.key === category)?.label || category}</h2></div><p>{filtered.length} item{filtered.length === 1 ? '' : 's'} available now</p></div>
        <div className="commerce-toolbar">
          <div className="commerce-filter-group">
            <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="All">All</option>{categories.filter((item) => item.key !== 'All').map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select><ChevronDown/></label>
            <label>Platform<select value={platform} onChange={(event) => setPlatform(event.target.value)}>{platformOptions.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown/></label>
          </div>
          <label className="commerce-sort">Sort by<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Featured</option><option value="price-low">Price: Low to high</option><option value="price-high">Price: High to low</option><option value="name">Name</option></select><ChevronDown/></label>
        </div>
        {loading ? <div className="commerce-empty"><Clock3 className="commerce-spin"/><h3>Loading the shelves...</h3></div>
          : loadError ? <div className="commerce-empty commerce-error"><h3>Inventory could not load</h3><p>{loadError}</p><button type="button" onClick={loadCatalog}>Try again</button></div>
          : filtered.length ? <div className="commerce-product-grid">{filtered.map((item) => <ProductCard item={item} key={item.id}/>)}</div>
          : <div className="commerce-empty"><Search/><h3>No matching inventory</h3><p>Try clearing the filters, or let us help find your item.</p><Link href={`/shop/request?item=${encodeURIComponent(query)}`}>Request this item</Link><button type="button" onClick={() => { setCategory('All'); setPlatform('All'); setQuery(''); }}>Clear filters</button></div>}
      </section>}

      <section className="reference-promos" aria-label="Explore the shelves">
        <div className="reference-promo reference-promo-games"><div><h2>Level up your collection</h2><p>New adventures, old favorites, and rare finds.</p><button type="button" onClick={() => showCategory('Games')}>Shop Games<ArrowRight/></button></div></div>
        <div className="reference-promo reference-promo-books"><div><h2>Page-turning picks</h2><p>Discover your next great read.</p><button type="button" onClick={() => showCategory('Books')}>Shop Books<ArrowRight/></button></div></div>
      </section>

      <footer className="commerce-footer">
        <div className="commerce-footer-brand"><Image src="/pixel-page-badge.webp" alt={profile.store_name} width={120} height={120} unoptimized/><span>{profile.tagline}</span></div>
        <div><strong>Shop</strong><button type="button" onClick={() => showCategory('All')}>All products</button>{categories.map((item) => <button type="button" key={item.key} onClick={() => showCategory(item.key)}>{item.label}</button>)}</div>
        <div><strong>Customer care</strong><Link href="/shop/pages/shipping">Shipping</Link><Link href="/shop/pages/returns">Returns</Link><Link href="/shop/pages/faq">FAQ</Link><Link href="/shop/pages/contact">Contact us</Link><Link href="/shop/request">Request an item</Link></div>
        <div><strong>About</strong><Link href="/shop/pages/our-story">Our story</Link><Link href="/shop/pages/store-info">Online-only shopping</Link><Link href="/shop/pages/privacy">Privacy</Link><Link href="/shop/pages/terms">Terms</Link></div>
        <div className="reference-footer-contact"><strong>Let&apos;s find your next favorite</strong><p>Questions about a find or an online order?</p><a href="mailto:support@pixelandpagellc.com">Email Pixel & Page <ArrowRight/></a><small>Online only. Shipping to your door.</small></div>
        <div className="commerce-footer-bottom"><span>© {new Date().getFullYear()} Pixel & Page, LLC</span><span>{profile.tagline}</span></div>
      </footer>

      {cartOpen && <button className="commerce-cart-overlay" onClick={() => setCartOpen(false)} aria-label="Close cart"/>}
      {cartOpen && <aside className="commerce-cart open" aria-label="Shopping cart">
        <div className="commerce-cart-header"><div><p className="commerce-kicker">YOUR CART</p><h2>{cartCount} item{cartCount === 1 ? '' : 's'}</h2></div><button type="button" aria-label="Close shopping cart" onClick={() => setCartOpen(false)}><X/></button></div>
        <div className="commerce-cart-items">
          {!cartItems.length ? <div className="commerce-cart-empty"><ShoppingBag/><h3>Your cart is empty</h3><button type="button" onClick={() => setCartOpen(false)}>Continue shopping</button></div> : cartItems.map((item) => <div className="commerce-cart-line" key={item.id}><div className="commerce-cart-thumb">{item.thumbnail_url || item.image_url ? <Image src={item.thumbnail_url || item.image_url || ''} alt="" width={64} height={64} unoptimized/> : <Gamepad2/>}</div><div><Link href={`/shop/product/${item.slug}`}>{item.title}</Link><small>{item.condition}</small><div className="commerce-cart-qty"><button type="button" aria-label={`Remove one ${item.title}`} onClick={() => updateCart(item, -1)}><Minus/></button><b>{cart[item.id]}</b><button type="button" aria-label={`Add one ${item.title}`} onClick={() => updateCart(item, 1)}><Plus/></button></div></div><strong>${(item.price * cart[item.id]).toFixed(2)}</strong></div>)}
        </div>
        {cartItems.length > 0 && <div className="commerce-cart-footer"><div><span>Subtotal</span><strong>${subtotal.toFixed(2)}</strong></div><p>Shipping and applicable tax are calculated during secure checkout. Stock is checked again before payment.</p><Link href="/shop/checkout" onClick={() => setCartOpen(false)}>Review & checkout <ArrowRight/></Link><small><ShieldCheck/>Secure payment with Stripe</small></div>}
      </aside>}
    </main>
  );
}
