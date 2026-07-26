'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Check, Gamepad2, Heart, MapPin, PackageCheck, ShieldCheck, ShoppingBag, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';

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
  description?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  brand?: string | null;
  barcode?: string | null;
};

export default function ProductPage() {
  const params = useParams();
  const slug = String(params?.slug || '');
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const result = await supabase.rpc('get_storefront_products', { requested_slug: 'pixel-and-page' });
      if (!result.error && result.data) {
        const match = result.data.find((item: any) => item.slug === slug);
        if (match) setProduct({ ...match, price: Number(match.price || 0), compare_at_price: match.compare_at_price ? Number(match.compare_at_price) : null, quantity: Number(match.quantity || 0) });
      }
      setLoading(false);
    };
    load();
  }, [slug]);

  const image = product?.image_url || product?.thumbnail_url || '';
  const savings = useMemo(() => product?.compare_at_price && product.compare_at_price > product.price ? product.compare_at_price - product.price : 0, [product]);

  const addToCart = () => {
    if (!product) return;
    let cart: Record<string, number> = {};
    try { cart = JSON.parse(window.localStorage.getItem('pixel-page-cart') || '{}'); } catch { /* ignore */ }
    cart[product.id] = Math.min(product.quantity, (cart[product.id] || 0) + 1);
    window.localStorage.setItem('pixel-page-cart', JSON.stringify(cart));
    setAdded(true);
  };

  if (loading) return <main className="commerce-page"><div className="commerce-empty"><h3>Loading product…</h3></div></main>;
  if (!product) return <main className="commerce-page"><Link href="/shop" className="commerce-breadcrumbs"><ArrowLeft size={14}/> Back to shop</Link><div className="commerce-empty"><h3>This item is no longer available.</h3><p>It may have sold or been removed from the storefront.</p><Link href="/shop">Browse live inventory</Link></div></main>;

  return (
    <main className="commerce-product-page">
      <div className="commerce-breadcrumbs"><Link href="/shop">Shop</Link> / <Link href="/shop#catalog">{product.category}</Link> / {product.title}</div>
      <div className="commerce-product-layout">
        <section className="commerce-product-gallery">{image ? <img src={image} alt={product.title}/> : <div className="commerce-placeholder"><Gamepad2 size={80}/><span>Image coming soon</span></div>}</section>
        <section className="commerce-product-detail">
          <p className="commerce-kicker">{product.platform || product.category}</p>
          <h1>{product.title}</h1>
          <div className="commerce-condition"><Check size={15}/>{product.condition || 'Available'}</div>
          <div className="commerce-price" style={{marginTop:18}}><strong>${product.price.toFixed(2)}</strong>{product.compare_at_price && product.compare_at_price > product.price && <del>${product.compare_at_price.toFixed(2)}</del>}</div>
          {savings > 0 && <p style={{color:'#c95d31',fontWeight:800}}>Save ${savings.toFixed(2)}</p>}
          <p className="commerce-product-detail-copy">{product.description || 'A live Pixel & Page inventory item. Photos, condition, and availability are synced from RetroLootPro so you can shop with confidence.'}</p>
          <div className="commerce-product-specs">
            <div><small>Condition</small><strong>{product.condition || 'Available'}</strong></div>
            <div><small>Platform / format</small><strong>{product.platform || product.category}</strong></div>
            <div><small>Availability</small><strong>{product.quantity === 1 ? 'Only one left' : `${product.quantity} available`}</strong></div>
            <div><small>Brand</small><strong>{product.brand || 'Pixel & Page inventory'}</strong></div>
          </div>
          <div className="commerce-add-panel"><button onClick={addToCart} disabled={product.quantity < 1}>{added ? 'Added to cart' : 'Add to cart'}</button></div>
          <div className="commerce-product-assurances"><span><ShieldCheck/>Secure checkout</span><span><Truck/>U.S. shipping</span><span><MapPin/>Local pickup</span></div>
          <div className="commerce-page-card" style={{marginTop:25}}><h3>Why shop Pixel & Page?</h3><p><PackageCheck size={16} style={{verticalAlign:'middle'}}/> Inventory is managed directly in RetroLootPro, so sold-out items are removed automatically and condition details stay tied to the exact item you are buying.</p></div>
          {added && <Link href="/shop/checkout" style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginTop:14,fontWeight:850,color:'#2b8b86'}}><ShoppingBag size={17}/> Continue to checkout</Link>}
        </section>
      </div>
    </main>
  );
}
