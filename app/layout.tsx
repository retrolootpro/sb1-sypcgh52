import './globals.css';
import './shop/commerce.css';
import './shop/commerce-fixes.css';
import './shop/commerce-controls.css';
import './shop/reference-design.css';
import './pixel-page-brand.css';
import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import { AuthProvider } from '@/lib/auth-context';
import { Toaster } from '@/components/ui/sonner';

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'] });

export const metadata: Metadata = {
  title: {
    default: 'Pixel & Page | Games, Books & Collectibles',
    template: '%s | Pixel & Page',
  },
  description: 'Games, books, and collectibles from Pixel & Page.',
  applicationName: 'Pixel & Page',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Pixel & Page',
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/pixel-page-badge.svg',
    shortcut: '/pixel-page-badge.svg',
    apple: '/pixel-page-badge.webp',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light pixel-page" style={{ colorScheme: 'light' }} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.classList.add('light','pixel-page');document.documentElement.classList.remove('apple');document.documentElement.style.colorScheme='light';`,
          }}
        />
      </head>
      <body className={spaceGrotesk.className}>
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
