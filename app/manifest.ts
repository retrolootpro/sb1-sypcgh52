import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pixel & Page Business',
    short_name: 'Pixel & Page',
    description: 'Inventory command center for resale operations',
    start_url: '/business',
    scope: '/',
    display: 'standalone',
    background_color: '#fffefa',
    theme_color: '#073442',
    icons: [
      {
        src: '/pixel-page-badge.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/pixel-page-badge.webp',
        sizes: '300x300',
        type: 'image/webp',
      },
    ],
  };
}
