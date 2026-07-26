'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Heart,
  Menu,
  Minus,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Truck,
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
  announcement: 'New inventory drops every week',
  pickup_name: 'Pixel & Page at Daytona Flea Market',
  pickup_details: 'Friday–Sunday. Pickup instructions are provided after checkout.',
  logo_path: '/pixel-page-logo.svg',
};

const toneFor = (value: string) => {
  const tones = ['teal', 'navy', 'rust', 'ice', 'purple', 'gold', 'sun', 'green'];
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return tones[Math.abs(hash) % tones.length];
};

export default function ShopPage() {
  const [products, setProducts] = useState<StorefrontProduct[]>([]);
  const [profile, setProfile] = useState<StorefrontProfile>(fallbackProfile);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fulfillment, setFulfillment] = useState<'shipping' | 'pickup'>('shipping');

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
          price: Number(item.price || 0),
          compare_at_price: item.compare_at_price ? Number(item.compare_at_price) : null,
          quantity: Number(item.quantity || 0),
          featured: Boolean(item.featured),
        })));
      }
      if (!profileResult.error && profileResult.data?.[0]) {
        setProfile({ ...fallbackProfile, ...profileResult.data[0] });
      }
      setLoading(false);
    };
    load();
    return () => { active = false; };
  }, []);

  const categories = useMemo(() => ['All', ...Array.from(new Set(products.map((item) => item.category || 'Other')))], [products]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) => {
      const categoryMatch = category === 'All' || product.category === category;
      const queryMatch = !q || `${product.title} ${product.platform} ${product.condition} ${product.brand || ''}`.toLowerCase().includes(q);
      return categoryMatch && queryMatch;
    });
  }, [products, category, query]);

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

  return (
    <main className="pp-store">
      <div className="pp-announcement">
        <span><Sparkles size={14} /> {profile.announcement}</span>
        <span className="announcement-wide">Free local pickup at our Daytona Flea Market shop</span>
      </div>

      <header className="pp-header">
        <a className="pp-logo pp-logo-image" href="#top" aria-label={`${profile.store_name} home`}>
          <img src={profile.logo_path || '/pixel-page-logo.svg'} alt={`${profile.store_name} — ${profile.tagline}`} />
        </a>
        <nav className={menuOpen ? 'pp-nav open' : 'pp-nav'}>
          {categories.filter((item) => item !== 'All').slice(0, 5).map((item) => (
            <button key={item} onClick={() => { setCategory(item); setMenuOpen(false); }}>{item}</button>
          ))}
          <a href="#visit">Visit Us</a>
        </nav>
        <div className="header-actions">
          <button className="icon-button menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu"><Menu size={21} /></button>
          <button className="icon-button" aria-label="Favorites"><Heart size={20} /></button>
          <button className="cart-button" onClick={() => setCartOpen(true)}><ShoppingBag size={20} /><span>Cart</span><b>{cartCount}</b></button>
        </div>
      </header>

      <section className="pp-hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">GAMES • BOOKS • COLLECTIBLES</p>
          <h1>Find your next<br/><em>favorite story.</em></h1>
          <p className="hero-sub">Live inventory from Pixel & Page. What you see online is what is currently available in RetroLootPro.</p>
          <div className="hero-actions">
            <a href="#shop" className="primary-button">Shop live inventory <ArrowRight size={18} /></a>
            <a href="#visit" className="text-button">Visit the store</a>
          </div>
          <div className="trust-row">
            <span><Check size={14} /> Tested merchandise</span>
            <span><Check size={14} /> Live stock counts</span>
            <span><Check size={14} /> Local pickup</span>
          </div>
        </div>
        <div className="hero-art brand-hero" aria-hidden="true">
          <img src="/pixel-page-logo.svg" alt="" />
        </div>
      </section>

      <section className="benefit-bar">
        <div><PackageCheck size={24}/><span><b>Connected inventory</b><small>Availability comes from RetroLootPro</small></span></div>
        <div><Truck size={24}/><span><b>Ship or pick up</b><small>Choose what works for you</small></span></div>
        <div><ShieldCheck size={24}/><span><b>Accurate condition</b><small>Photos and notes from our catalog</small></span></div>
      </section>

      <section className="shop-section" id="shop">
        <div className="section-heading">
          <div><p className="eyebrow">LIVE FROM RETROLOOTPRO</p><h2>Available now</h2></div>
          <p>Published items automatically disappear when they sell out or are archived.</p>
        </div>
        <div className="shop-toolbar">
          <div className="category-tabs">
            {categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}
          </div>
          <label className="search-box"><Search size={18}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the shelves" /></label>
        </div>

        {loading ? <div className="empty-state"><h3>Loading the shelves…</h3></div> : (
          <div className="product-grid">
            {filtered.map((product) => (
              <article className="product-card" key={product.id}>
                <div className={`product-art tone-${toneFor(product.category || product.title)}`}>
                  {product.featured && <span className="product-badge">Featured</span>}
                  <button className="favorite" aria-label={`Save ${product.title}`}><Heart size={18}/></button>
                  {product.image_url || product.thumbnail_url ? (
                    <img className="product-photo" src={product.image_url || product.thumbnail_url || ''} alt={product.title} />
                  ) : (
                    <div className="art-object"><span>{product.title.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase()}</span></div>
                  )}
                </div>
                <div className="product-info">
                  <p>{product.platform || product.category}</p>
                  <h3>{product.title}</h3>
                  <span className="condition"><Check size={12}/>{product.condition || 'Available'}</span>
                  <div className="product-bottom">
                    <div className="price"><b>${product.price.toFixed(2)}</b>{product.compare_at_price && product.compare_at_price > product.price && <del>${product.compare_at_price.toFixed(2)}</del>}</div>
                    {cart[product.id] ? (
                      <div className="qty-control"><button onClick={() => updateCart(product, -1)}><Minus size={14}/></button><b>{cart[product.id]}</b><button onClick={() => updateCart(product, 1)}><Plus size={14}/></button></div>
                    ) : (
                      <button className="add-button" onClick={() => { updateCart(product, 1); setCartOpen(true); }}><Plus size={16}/> Add</button>
                    )}
                  </div>
                  {product.quantity === 1 && <small className="last-one">Only one available</small>}
                </div>
              </article>
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && <div className="empty-state"><Search size={32}/><h3>No published products found</h3><p>Publish inventory from RetroLootPro’s Storefront Manager.</p></div>}
      </section>

      <section className="split-banner">
        <div className="banner-copy"><p className="eyebrow">SELL OR TRADE</p><h2>Give your old favorites<br/>a new save file.</h2><p>Bring us your games, consoles, books, and collectibles. Choose cash or get more value in store credit.</p><a href="#visit" className="cream-button">How trade-ins work <ArrowRight size={17}/></a></div>
        <div className="trade-stack"><div>YOUR<br/>STUFF</div><ArrowRight size={34}/><div>NEW<br/>FINDS</div></div>
      </section>

      <section className="visit-section" id="visit">
        <div className="visit-card">
          <div className="visit-icon"><Store size={36}/></div>
          <div><p className="eyebrow">COME SAY HI</p><h2>{profile.pickup_name}</h2><p>{profile.pickup_details}</p></div>
          <div className="visit-details"><b>Daytona Flea Market</b><span>Friday–Sunday</span>{profile.support_email && <span>{profile.support_email}</span>}<a href="#top">Back to top <ArrowRight size={16}/></a></div>
        </div>
      </section>

      <footer className="pp-footer">
        <div className="footer-brand"><img className="footer-logo" src="/pixel-page-logo.svg" alt={profile.store_name} /><p>Games, books, and collectibles for every kind of player and reader.</p></div>
        <div><b>Shop</b>{categories.filter((item) => item !== 'All').slice(0, 4).map((item) => <a href="#shop" key={item}>{item}</a>)}</div>
        <div><b>Help</b><a href="#visit">Pickup</a><a href="#visit">Shipping</a><a href="#visit">Trade-ins</a><a href="#visit">Contact</a></div>
        <div><b>Follow the inventory</b><p>New arrivals, Whatnot shows, and store updates.</p></div>
      </footer>

      {cartOpen && <div className="cart-overlay" onClick={() => setCartOpen(false)} />}
      <aside className={cartOpen ? 'cart-drawer open' : 'cart-drawer'}>
        <div className="cart-header"><div><p className="eyebrow">YOUR BAG</p><h2>{cartCount} {cartCount === 1 ? 'item' : 'items'}</h2></div><button className="icon-button" onClick={() => setCartOpen(false)}><X size={21}/></button></div>
        <div className="cart-items">
          {cartItems.length === 0 ? <div className="empty-cart"><ShoppingBag size={38}/><h3>Your bag is empty</h3><p>Your next favorite is waiting on the shelves.</p><button className="primary-button" onClick={() => setCartOpen(false)}>Keep shopping</button></div> : cartItems.map((item) => (
            <div className="cart-line" key={item.id}><div className={`cart-thumb tone-${toneFor(item.category || item.title)}`}>{item.thumbnail_url ? <img src={item.thumbnail_url} alt="" /> : item.title.slice(0, 2).toUpperCase()}</div><div><b>{item.title}</b><small>{item.condition}</small><div className="qty-control"><button onClick={() => updateCart(item, -1)}><Minus size={13}/></button><b>{cart[item.id]}</b><button onClick={() => updateCart(item, 1)}><Plus size={13}/></button></div></div><strong>${(item.price * cart[item.id]).toFixed(2)}</strong></div>
          ))}
        </div>
        {cartItems.length > 0 && <div className="cart-checkout">
          <div className="fulfillment-toggle"><button className={fulfillment === 'shipping' ? 'active' : ''} onClick={() => setFulfillment('shipping')}><Truck size={18}/><span><b>Ship it</b><small>Rates at checkout</small></span></button><button className={fulfillment === 'pickup' ? 'active' : ''} onClick={() => setFulfillment('pickup')}><Store size={18}/><span><b>Pick up</b><small>Daytona store</small></span></button></div>
          <div className="subtotal"><span>Subtotal</span><b>${subtotal.toFixed(2)}</b></div>
          <p>Checkout activation is the next payment-integration step. Your cart and live inventory are already connected.</p>
          <button className="checkout-button" disabled>Checkout coming online next</button>
        </div>}
      </aside>
    </main>
  );
}
