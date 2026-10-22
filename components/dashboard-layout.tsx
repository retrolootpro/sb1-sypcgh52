'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpRight, Bot, Boxes, ChartNoAxesCombined, ChevronDown, ClipboardCheck, ClipboardList,
  DollarSign, FileLock2, FlaskConical, Gavel, LayoutDashboard, ListChecks, LogOut, Menu,
  MonitorUp, Package, Printer, ScanBarcode, Settings, ShoppingBag, Store, Target, Truck,
  Users, X, BookOpen, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { businessPath, legacyBusinessPath, staffReturnPath } from '@/lib/business-routes';
import { getAccountSecuritySettings, isMfaSatisfied } from '@/lib/security-services';
import { QuickDealScannerLauncher } from '@/components/quick-deal-scanner-launcher';

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; adminOnly?: boolean; items: NavItem[] };
const groups: NavGroup[] = [
  { label: 'Start here', items: [
    { href: '/dashboard', label: 'Business overview', icon: LayoutDashboard },
    { href: '/assistant', label: 'Business assistant', icon: Bot },
  ] },
  { label: 'Orders & fulfillment', items: [
    { href: '/storefront/requests', label: 'Shop orders & requests', icon: ShoppingBag },
    { href: '/shipping', label: 'Shipping operations', icon: Truck },
    { href: '/storefront/shipping', label: 'Packages & carriers', icon: Boxes },
  ] },
  { label: 'Inventory & catalog', items: [
    { href: '/inventory', label: 'Inventory', icon: Package },
    { href: '/scan', label: 'Scan & add inventory', icon: ScanBarcode },
    { href: '/prep', label: 'Preparation', icon: ClipboardList },
    { href: '/review', label: 'Review queue', icon: ClipboardCheck },
    { href: '/labels?manual=1', label: 'Product labels', icon: Printer },
    { href: '/storefront', label: 'Storefront publishing', icon: Store },
  ] },
  { label: 'Sales channels', items: [
    { href: '/shows', label: 'Whatnot shows', icon: ListChecks },
    { href: '/planning', label: 'Lot analyzer', icon: Target },
    { href: '/planning?tab=bundles', label: 'Bundles', icon: Boxes },
    { href: '/planning?tab=disputes', label: 'Disputes', icon: Gavel },
    { href: '/pos', label: 'Point of sale', icon: MonitorUp },
  ] },
  { label: 'Business', items: [
    { href: '/finance', label: 'Finance', icon: DollarSign },
    { href: '/insights', label: 'Reports & insights', icon: ChartNoAxesCombined },
    { href: '/documents', label: 'Documents', icon: FileLock2 },
    { href: '/tasks', label: 'Tasks', icon: ClipboardCheck },
  ] },
  { label: 'Administration', adminOnly: true, items: [
    { href: '/employees', label: 'Team', icon: Users },
    { href: '/settings', label: 'Settings & integrations', icon: Settings },
  ] },
  { label: 'Tools & support', items: [
    { href: '/scanner-lab', label: 'Scanner Lab', icon: FlaskConical },
    { href: '/help', label: 'Help & manual', icon: BookOpen },
  ] },
];

function isActive(item: NavItem, pathname: string, params: URLSearchParams) {
  const [path, query] = item.href.split('?');
  if (path === '/planning') return pathname === path && (query ? params.get('tab') === new URLSearchParams(query).get('tab') : !params.get('tab'));
  if (path === '/storefront') return pathname === path;
  return pathname === path || (path !== '/dashboard' && pathname.startsWith(`${path}/`));
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, accountId, accessError, signOut, isAdmin, accountRole, refreshAccount } = useAuth();
  const router = useRouter();
  const currentPath = usePathname();
  const params = useSearchParams();
  const pathname = legacyBusinessPath(currentPath) || currentPath;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [securityError, setSecurityError] = useState('');
  const menuButton = useRef<HTMLButtonElement>(null);
  const mobileNav = useRef<HTMLElement>(null);
  const active = groups.flatMap(group => group.items).filter(item => isActive(item, pathname, new URLSearchParams(params.toString()))).sort((a, b) => b.href.length - a.href.length)[0];

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(staffReturnPath(`${currentPath}${params.size ? `?${params}` : ''}${window.location.hash}`))}`);
  }, [user, loading, router, currentPath, params]);
  useEffect(() => {
    if (loading || !user || !accountId || pathname === '/settings') return;
    let cancelled = false;
    setSecurityError('');
    (async () => {
      try {
        const settings = await getAccountSecuritySettings();
        if (!cancelled && settings?.require_mfa && !(await isMfaSatisfied())) router.replace('/business/settings?security=mfa');
      } catch (error) {
        console.error('Workspace security settings:', error);
        if (!cancelled) setSecurityError('Security settings could not be checked. Open Settings before continuing sensitive work.');
      }
    })();
    return () => { cancelled = true; };
  }, [loading, user, accountId, pathname, router]);
  useEffect(() => { setMobileOpen(false); }, [currentPath, params]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    mobileNav.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); menuButton.current?.focus(); }
      if (event.key !== 'Tab') return;
      const controls = mobileNav.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', keyboard); };
  }, [mobileOpen]);

  if (loading) return <main className="staff-access-screen"><p role="status">Opening your Pixel &amp; Page workspace...</p></main>;
  if (!user) return null;
  if (!accountId) return <main className="staff-access-screen"><h1>Team access required</h1><p role="alert">{accessError || 'This login does not have active Pixel & Page team access.'}</p><button className="brand-button" onClick={refreshAccount}>Retry access check</button><button className="staff-text-button" onClick={signOut}>Sign out</button><Link href="/">Back to the shop</Link></main>;

  const sidebar = <><Link className="workspace-brand" href="/business" onClick={() => setMobileOpen(false)}>
    <Image src="/storefront/pixel-page-wordmark.png" width={220} height={44} alt="Pixel & Page" priority unoptimized/><span>BUSINESS WORKSPACE</span>
  </Link>
    <Link className="workspace-store-link" href="/"><Store size={17}/> View storefront <ArrowUpRight size={15}/></Link>
    <nav aria-label="Business navigation" className="workspace-nav">{groups.filter(group => !group.adminOnly || isAdmin).map(group => {
      const containsActive = group.items.some(item => isActive(item, pathname, new URLSearchParams(params.toString())));
      const open = openGroups[group.label] ?? (containsActive || ['Start here', 'Orders & fulfillment', 'Inventory & catalog'].includes(group.label));
      return <div key={group.label}><button className="workspace-nav-heading" aria-expanded={open} aria-controls={`nav-${group.label.replace(/\W/g, '-')}`} onClick={() => setOpenGroups(previous => ({ ...previous, [group.label]: !open }))}>
        {group.label}<ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : undefined }}/></button>
        {open && <div id={`nav-${group.label.replace(/\W/g, '-')}`}>{group.items.map(item => <Link href={businessPath(item.href)} key={item.href} aria-current={active?.href === item.href ? 'page' : undefined} onClick={() => setMobileOpen(false)}><item.icon size={18}/>{item.label}</Link>)}</div>}
      </div>;
    })}</nav>
    <div className="workspace-user"><span>{user.email}</span><small>{accountRole === 'admin' ? 'Owner / administrator' : 'Team member'}</small><button onClick={signOut}><LogOut size={16}/> Sign out</button></div>
  </>;
  return <div className="app-shell workspace-shell">
    <a href="#workspace-content" className="workspace-skip">Skip to main content</a>
    <aside className="workspace-sidebar">{sidebar}</aside>
    {mobileOpen && <div className="workspace-mobile-overlay" onClick={() => { setMobileOpen(false); menuButton.current?.focus(); }}>
      <aside ref={mobileNav} className="workspace-mobile-nav" role="dialog" aria-modal="true" aria-label="Workspace menu" onClick={event => event.stopPropagation()}>
        <button className="workspace-close" onClick={() => { setMobileOpen(false); menuButton.current?.focus(); }} aria-label="Close business menu"><X/></button>{sidebar}
      </aside>
    </div>}
    <div className="workspace-body"><header className="workspace-header">
      <button ref={menuButton} className="workspace-menu" aria-label="Open business menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu/></button>
      <div className="workspace-header-title"><p>PIXEL &amp; PAGE BUSINESS</p><strong>{active?.label || 'Business workspace'}</strong></div>
      <div className="workspace-header-actions"><Link href="/" aria-label="View shop"><Store size={17}/><span>View shop</span></Link><QuickDealScannerLauncher/><Link href="/business/scan" aria-label="Add inventory" className="brand-button"><ScanBarcode size={17}/><span>Add inventory</span></Link></div>
    </header>
      {accessError && <p role="alert" className="staff-access-error">{accessError}</p>}
      {securityError && <p role="alert" className="staff-access-error">{securityError} <Link href="/business/settings?security=mfa">Open Settings</Link></p>}
      <main id="workspace-content" tabIndex={-1} className="app-content workspace-content">{children}</main>
    </div>
  </div>;
}
