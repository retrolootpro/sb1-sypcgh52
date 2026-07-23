import './globals.css';
import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import { AuthProvider } from '@/lib/auth-context';
import { Toaster } from '@/components/ui/sonner';

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'] });

export const metadata: Metadata = {
  title: {
    default: 'RetroLootPro',
    template: '%s | RetroLootPro',
  },
  description: 'Professional inventory and deal analysis platform for video game resellers',
  applicationName: 'RetroLootPro',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'RetroLootPro',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icons/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var mode=localStorage.getItem('retroloot-theme');var isLight=mode==='light';var isApple=mode==='apple';document.documentElement.classList.toggle('light',isLight);document.documentElement.classList.toggle('apple',isApple);document.documentElement.style.colorScheme=(isLight||isApple)?'light':'dark';}catch(e){}})();`,
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
