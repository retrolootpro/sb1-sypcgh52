import type { Metadata } from 'next';
import './storefront.css';
import './live-storefront.css';

export const metadata: Metadata = {
  title: 'Pixel & Page | Games, Books & Collectibles',
  description:
    'Shop live retro games, modern favorites, consoles, collectibles, and BookTok reads from Pixel & Page.',
};

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return children;
}
