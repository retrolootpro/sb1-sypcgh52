'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Check, Gamepad2, MapPin, PackageCheck, ShieldCheck, ShoppingBag, Truck } from 'lucide-react';

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
};

export default function ProductPage() {
  const params = useParams();
  const slug = String(params?.slug || '');
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [added, setAdded] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/storefront/catalog', { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || 'Product could not be loaded.');
        const match = (result.products || []).find((item: Product) => item.slug === slug);
        if (match) setProduct({ ...match, price: Number(match.price || 0), quantity: Number(match.quantity || 0) });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Product could not be loaded.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [slug]);

  const image = product?.image_url || product?.thumbnail_url || '';
  const savings = useMemo(() => product?.compare_at_price && product.compare_at_price > product.price ? product.compare_at_price - product.price : 0, [product]);

  const addToCart = () => {
    if (!product) return;
    let cart: Record<string, number> = {};
    try { cart = JSON.parse(window.localStorage.getItem('pixel-page-cart') || '{}'); } catch { cart = {}; }
    cart[product.id] = Math.min(product.quantity, (cart[product.id] || 0) + 1);
    window.localStorage.setItem('pixel-page-cart', JSON.stringify(cart));
    setAdded(true);
  };

  if (loading) return <main className="commerce-page"><div className="commerce-empty"><h3>Loading product...</h3></div></main>;
  if (!product) return <main className="commerce-page"><Link href="/shop" className="commerce-breadcrumbs"><ArrowLeft/>Back to shop</Link><div className="commerce-empty"><h3>{error ? 'Product could not load' : 'This item is no longer available.'}</h3><p>{error || 'It may have sold or been removed from inventory.'}</p><Link href="/shop">Browse live inventory</Link></div></main>;

  return (
    <main className="commerce-product-page">
      <div className="commerce-breadcrumbs"><Link href="/shop">Shop</Link> / <Link href="/shop#catalog">{product.category}</Link> / {product.title}</div>
      <div className="commerce-product-layout">
        <section className="commerce-product-gallery">{image ? <img src={image} alt={product.title}/> : <div className="commerce-placeholder"><Gamepad2/><span>Image coming soon</span></div>}</section>
        <section className="commerce-product-detail">
          <p className="commerce-kicker">{product.platform || product.category}</p>
          <h1>{product.title}</h1>
          <div className="commerce-condition"><Check/>{product.condition}</div>
          <div className="commerce-price commerce-detail-price"><strong>${product.price.toFixed(2)}</strong>{product.compare_at_price && product.compare_at_price > product.price ? <del>${product.compare_at_price.toFixed(2)}</del> : null}</div>
          {savings > 0 && <p className="commerce-savings">Save ${savings.toFixed(2)}</p>}
          <p className="commerce-product-detail-copy">{product.description || 'A live Pixel & Page inventory item with availability managed directly in RetroLootPro.'}</p>
          <div className="commerce-product-specs">
            <div><small>Condition</small><strong>{product.condition}</strong></div>
            <div><small>Platform / format</small><strong>{product.platform || product.category}</strong></div>
            <div><small>Availability</small><strong>{product.quantity === 1 ? 'Only one left' : `${product.quantity} available`}</strong></div>
            <div><small>Brand</small><strong>{product.brand || 'Pixel & Page inventory'}</strong></div>
          </div>
          <div className="commerce-add-panel"><button type="button" onClick={addToCart} disabled={product.quantity < 1}>{added ? 'Added to cart' : 'Add to cart'}</button></div>
          <div className="commerce-product-assurances"><span><ShieldCheck/>Secure checkout</span><span><Truck/>U.S. shipping</span><span><MapPin/>Local pickup</span></div>
          <div className="commerce-page-card commerce-product-note"><h3>Live RetroLootPro inventory</h3><p><PackageCheck/>This exact item is checked against current quantity before checkout.</p></div>
          {added && <Link href="/shop/checkout" className="commerce-continue-checkout"><ShoppingBag/>Continue to checkout</Link>}
        </section>
      </div>
    </main>
  );
}
