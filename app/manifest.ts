import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RetroLootPro',
    short_name: 'RetroLootPro',
    description: 'Inventory command center for resale operations',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#050505',
    theme_color: '#39ff6a',
    icons: [
      {
        src: '/icons/retroloot-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/retroloot-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}
