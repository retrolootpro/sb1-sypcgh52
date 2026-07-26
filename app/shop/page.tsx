'use client';

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Gamepad2,
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

type Product = {
  id: number;
  title: string;
  category: 'Games' | 'Consoles' | 'Books' | 'Collectibles';
  platform: string;
  condition: string;
  price: number;
  oldPrice?: number;
  stock: number;
  badge?: string;
  tone: string;
  art: string;
};

const products: Product[] = [
  { id: 1, title: 'The Legend of Zelda: Wind Waker', category: 'Games', platform: 'Nintendo GameCube', condition: 'Complete in Box', price: 79.99, stock: 1, badge: 'Staff Pick', tone: 'teal', art: 'WW' },
  { id: 2, title: 'PlayStation 2 Slim Console', category: 'Consoles', platform: 'PlayStation 2', condition: 'Tested • Very Good', price: 119.99, stock: 1, badge: 'Ready to Play', tone: 'navy', art: 'PS2' },
  { id: 3, title: 'Butcher & Blackbird', category: 'Books', platform: 'Paperback', condition: 'New', price: 17.99, oldPrice: 19.99, stock: 4, badge: 'BookTok Favorite', tone: 'rust', art: 'B&B' },
  { id: 4, title: 'Pokémon Crystal Version', category: 'Games', platform: 'Game Boy Color', condition: 'Loose • Tested', price: 139.99, stock: 1, badge: 'Rare Find', tone: 'ice', art: 'PK' },
  { id: 5, title: 'Nintendo 64 Controller — Atomic Purple', category: 'Collectibles', platform: 'Nintendo 64', condition: 'Original • Tested', price: 34.99, stock: 2, tone: 'purple', art: 'N64' },
  { id: 6, title: 'Quicksilver Deluxe Edition', category: 'Books', platform: 'Hardcover', condition: 'New', price: 27.99, stock: 3, badge: 'Sprayed Edges', tone: 'gold', art: 'QS' },
  { id: 7, title: 'Super Mario Sunshine', category: 'Games', platform: 'Nintendo GameCube', condition: 'Complete in Box', price: 44.99, stock: 1, tone: 'sun', art: 'SMS' },
  { id: 8, title: 'Xbox Series Controller — Carbon Black', category: 'Collectibles', platform: 'Xbox', condition: 'Open Box', price: 39.99, oldPrice: 49.99, stock: 2, badge: 'Great Deal', tone: 'green', art: 'XB' },
];

const categories = ['All', 'Games', 'Consoles', 'Books', 'Collectibles'] as const;

export default function ShopPage() {
  const [category, setCategory] = useState<(typeof categories)[number]>('All');
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Record<number, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fulfillment, setFulfillment] = useState<'shipping' | 'pickup'>('shipping');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) => {
      const categoryMatch = category === 'All' || product.category === category;
      const queryMatch = !q || `${product.title} ${product.platform} ${product.condition}`.toLowerCase().includes(q);
      return categoryMatch && queryMatch;
    });
  }, [category, query]);

  const cartItems = products.filter((product) => cart[product.id]);
  const cartCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * cart[item.id], 0);

  const updateCart = (product: Product, delta: number) => {
    setCart((current) => {
      const next = Math.max(0, Math.min(product.stock, (current[product.id] || 0) + delta));
      const copy = { ...current };
      if (next === 0) delete copy[product.id];
      else copy[product.id] = next;
      return copy;
    });
  };

  return (
    <main className="pp-store">
      <div className="pp-announcement">
        <span><Sparkles size={14} /> New inventory drops every week</span>
        <span className="announcement-wide">Free local pickup at our Daytona Flea Market shop</span>
      </div>

      <header className="pp-header">
        <a className="pp-logo" href="#top" aria-label="Pixel and Page home">
          <span className="logo-mark"><Gamepad2 size={24} /><BookOpen size={18} /></span>
          <span><strong>PIXEL</strong><i>&</i><strong>PAGE</strong><small>EVERY STORY HAS A SAVE POINT</small></span>
        </a>

        <nav className={menuOpen ? 'pp-nav open' : 'pp-nav'}>
          <button onClick={() => { setCategory('Games'); setMenuOpen(false); }}>Video Games</button>
          <button onClick={() => { setCategory('Consoles'); setMenuOpen(false); }}>Consoles</button>
          <button onClick={() => { setCategory('Books'); setMenuOpen(false); }}>Books</button>
          <button onClick={() => { setCategory('Collectibles'); setMenuOpen(false); }}>Collectibles</button>
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
          <p className="hero-sub">From retro cartridges to fresh BookTok favorites, every shelf has something worth discovering.</p>
          <div className="hero-actions">
            <a href="#shop" className="primary-button">Shop new arrivals <ArrowRight size={18} /></a>
            <a href="#visit" className="text-button">Visit the store</a>
          </div>
          <div className="trust-row">
            <span><Check size={14} /> Tested games</span>
            <span><Check size={14} /> Secure checkout</span>
            <span><Check size={14} /> Local pickup</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-card card-game"><span>PLAYER 1</span><Gamepad2 size={82} /><b>PRESS START</b></div>
          <div className="hero-card card-book"><small>PIXEL & PAGE PICKS</small><BookOpen size={72} /><b>Stories worth<br/>staying up for.</b></div>
          <div className="pixel-spark spark-1">✦</div><div className="pixel-spark spark-2">◆</div><div className="pixel-spark spark-3">+</div>
        </div>
      </section>

      <section className="benefit-bar">
        <div><PackageCheck size={24}/><span><b>Carefully inspected</b><small>Condition notes you can trust</small></span></div>
        <div><Truck size={24}/><span><b>Ship or pick up</b><small>Choose what works for you</small></span></div>
        <div><ShieldCheck size={24}/><span><b>Secure payments</b><small>Checkout powered by Clover</small></span></div>
      </section>

      <section className="shop-section" id="shop">
        <div className="section-heading">
          <div><p className="eyebrow">FRESH ON THE SHELVES</p><h2>New arrivals</h2></div>
          <p>One-of-a-kind finds move fast. Inventory shown here is available now.</p>
        </div>

        <div className="shop-toolbar">
          <div className="category-tabs">
            {categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}
          </div>
          <label className="search-box"><Search size={18}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the shelves" /></label>
        </div>

        <div className="product-grid">
          {filtered.map((product) => (
            <article className="product-card" key={product.id}>
              <div className={`product-art tone-${product.tone}`}>
                {product.badge && <span className="product-badge">{product.badge}</span>}
                <button className="favorite" aria-label={`Save ${product.title}`}><Heart size={18}/></button>
                <div className="art-object"><span>{product.art}</span></div>
              </div>
              <div className="product-info">
                <p>{product.platform}</p>
                <h3>{product.title}</h3>
                <span className="condition"><Check size={12}/>{product.condition}</span>
                <div className="product-bottom">
                  <div className="price"><b>${product.price.toFixed(2)}</b>{product.oldPrice && <del>${product.oldPrice.toFixed(2)}</del>}</div>
                  {cart[product.id] ? (
                    <div className="qty-control"><button onClick={() => updateCart(product, -1)}><Minus size={14}/></button><b>{cart[product.id]}</b><button onClick={() => updateCart(product, 1)}><Plus size={14}/></button></div>
                  ) : (
                    <button className="add-button" onClick={() => { updateCart(product, 1); setCartOpen(true); }}><Plus size={16}/> Add</button>
                  )}
                </div>
                {product.stock === 1 && <small className="last-one">Only one available</small>}
              </div>
            </article>
          ))}
        </div>
        {filtered.length === 0 && <div className="empty-state"><Search size={32}/><h3>No treasures found</h3><p>Try a different search or category.</p></div>}
      </section>

      <section className="split-banner">
        <div className="banner-copy"><p className="eyebrow">SELL OR TRADE</p><h2>Give your old favorites<br/>a new save file.</h2><p>Bring us your games, consoles, books, and collectibles. Choose cash or get more value in store credit.</p><a href="#visit" className="cream-button">How trade-ins work <ArrowRight size={17}/></a></div>
        <div className="trade-stack"><div>YOUR<br/>STUFF</div><ArrowRight size={34}/><div>NEW<br/>FINDS</div></div>
      </section>

      <section className="visit-section" id="visit">
        <div className="visit-card">
          <div className="visit-icon"><Store size={36}/></div>
          <div><p className="eyebrow">COME SAY HI</p><h2>Shop Pixel & Page in person.</h2><p>Browse the full selection, trade in your collection, or pick up an online order at our Daytona Flea Market storefront.</p></div>
          <div className="visit-details"><b>Daytona Flea Market</b><span>Friday–Sunday</span><span>Store hours shown at checkout</span><a href="#top">Get store details <ArrowRight size={16}/></a></div>
        </div>
      </section>

      <footer className="pp-footer">
        <div className="footer-brand"><div className="pp-logo light"><span className="logo-mark"><Gamepad2 size={24}/><BookOpen size={18}/></span><span><strong>PIXEL</strong><i>&</i><strong>PAGE</strong></span></div><p>Games, books, and collectibles for every kind of player and reader.</p></div>
        <div><b>Shop</b><a href="#shop">Video Games</a><a href="#shop">Consoles</a><a href="#shop">Books</a><a href="#shop">Collectibles</a></div>
        <div><b>Help</b><a href="#visit">Pickup</a><a href="#visit">Shipping</a><a href="#visit">Returns</a><a href="#visit">Contact</a></div>
        <div><b>Follow the inventory</b><p>New arrivals, Whatnot shows, and store updates.</p><div className="email-field"><input placeholder="Email address"/><button><ArrowRight size={18}/></button></div></div>
      </footer>

      {cartOpen && <div className="cart-overlay" onClick={() => setCartOpen(false)} />}
      <aside className={cartOpen ? 'cart-drawer open' : 'cart-drawer'}>
        <div className="cart-header"><div><p className="eyebrow">YOUR BAG</p><h2>{cartCount} {cartCount === 1 ? 'item' : 'items'}</h2></div><button className="icon-button" onClick={() => setCartOpen(false)}><X size={21}/></button></div>
        <div className="cart-items">
          {cartItems.length === 0 ? <div className="empty-cart"><ShoppingBag size={38}/><h3>Your bag is empty</h3><p>Your next favorite is waiting on the shelves.</p><button className="primary-button" onClick={() => setCartOpen(false)}>Keep shopping</button></div> : cartItems.map((item) => (
            <div className="cart-line" key={item.id}><div className={`cart-thumb tone-${item.tone}`}>{item.art}</div><div><b>{item.title}</b><small>{item.condition}</small><div className="qty-control"><button onClick={() => updateCart(item, -1)}><Minus size={13}/></button><b>{cart[item.id]}</b><button onClick={() => updateCart(item, 1)}><Plus size={13}/></button></div></div><strong>${(item.price * cart[item.id]).toFixed(2)}</strong></div>
          ))}
        </div>
        {cartItems.length > 0 && <div className="cart-checkout">
          <div className="fulfillment-toggle"><button className={fulfillment === 'shipping' ? 'active' : ''} onClick={() => setFulfillment('shipping')}><Truck size={18}/><span><b>Ship it</b><small>Rates at checkout</small></span></button><button className={fulfillment === 'pickup' ? 'active' : ''} onClick={() => setFulfillment('pickup')}><Store size={18}/><span><b>Pick up</b><small>Daytona store</small></span></button></div>
          <div className="subtotal"><span>Subtotal</span><b>${subtotal.toFixed(2)}</b></div>
          <p>Taxes and {fulfillment === 'shipping' ? 'shipping' : 'pickup details'} calculated at checkout.</p>
          <button className="checkout-button">Checkout securely <ArrowRight size={18}/></button>
          <small className="secure-note"><ShieldCheck size={14}/> Secure checkout powered by Clover</small>
        </div>}
      </aside>
    </main>
  );
}
