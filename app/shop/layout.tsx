import type { Metadata } from 'next';
import './commerce.css';
import './commerce-fixes.css';
import './commerce-controls.css';
import './reference-design.css';
import ShopFrame from './shop-frame';

export const metadata: Metadata = {
  title: 'Pixel & Page | Games, Books & Collectibles',
  description:
    'Shop live retro games, modern favorites, consoles, collectibles, and BookTok reads from Pixel & Page.',
};

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return <ShopFrame>{children}</ShopFrame>;
}
