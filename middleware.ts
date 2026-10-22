import { NextRequest, NextResponse } from 'next/server';
import { businessPath, legacyBusinessPath } from '@/lib/business-routes';

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const legacy = legacyBusinessPath(url.pathname);
  if (legacy) {
    url.pathname = legacy;
    const response = NextResponse.rewrite(url);
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  }
  const destination = businessPath(url.pathname);
  if (destination !== url.pathname) {
    url.pathname = destination;
    return NextResponse.redirect(url, 307);
  }
  const response = NextResponse.next();
  if (url.pathname === '/login' || url.pathname.startsWith('/business')) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export const config = {
  matcher: ['/business/:path*', '/login', '/dashboard/:path*', '/inventory/:path*', '/scan/:path*',
    '/prep/:path*', '/tasks/:path*', '/review/:path*', '/labels/:path*', '/planning/:path*',
    '/shows/:path*', '/shipping/:path*', '/storefront/:path*', '/finance/:path*', '/insights/:path*',
    '/documents/:path*', '/settings/:path*', '/employees/:path*', '/scanner-lab/:path*',
    '/help/:path*', '/assistant/:path*', '/pos/:path*', '/deal-scanner/:path*', '/design-preview/:path*'],
};
