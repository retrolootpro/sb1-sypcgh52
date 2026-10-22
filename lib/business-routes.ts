export const businessModules = [
  'dashboard', 'inventory', 'scan', 'prep', 'tasks', 'review', 'labels',
  'planning', 'shows', 'shipping', 'storefront', 'finance', 'insights',
  'documents', 'settings', 'employees', 'scanner-lab', 'help', 'assistant', 'pos', 'deal-scanner', 'design-preview',
] as const;

export function businessPath(path: string) {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const url = new URL(path, 'https://workspace.invalid');
  const [module, ...rest] = url.pathname.slice(1).split('/');
  if (!businessModules.some(value => value === module)) return path;
  const pathname = module === 'dashboard' ? '/business'
    : module === 'storefront' && rest[0] === 'requests' ? `/business/orders${rest.length > 1 ? `/${rest.slice(1).join('/')}` : ''}`
    : `/business${url.pathname}`;
  return `${pathname}${url.search}${url.hash}`;
}

export function legacyBusinessPath(pathname: string) {
  if (pathname === '/business' || pathname === '/business/') return '/dashboard';
  if (pathname === '/business/orders' || pathname.startsWith('/business/orders/')) {
    return pathname.replace('/business/orders', '/storefront/requests');
  }
  if (pathname.startsWith('/business/')) {
    const legacy = pathname.slice('/business'.length);
    if (businessModules.some(module => legacy === `/${module}` || legacy.startsWith(`/${module}/`))) return legacy;
  }
  return null;
}

export function staffReturnPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/business';
  try {
    const url = new URL(value, 'https://workspace.invalid');
    if (url.origin !== 'https://workspace.invalid') return '/business';
    const path = businessPath(`${url.pathname}${url.search}${url.hash}`);
    return legacyBusinessPath(new URL(path, url.origin).pathname) ? path : '/business';
  } catch {
    return '/business';
  }
}
