'use client';

import { useAuth } from '@/lib/auth-context';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  Package,
  ListChecks,
  Settings,
  LogOut,
  ScanBarcode,
  ClipboardCheck,
  Users,
  Menu,
  X,
  Terminal,
  Truck,
  DollarSign,
  Lightbulb,
  ClipboardList,
  Bot,
  ChevronRight,
  ChevronDown,
  Target,
  BookOpen,
  Gavel,
  Boxes,
  FileLock2,
  MonitorUp,
  Printer,
  Search,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { QuickDealScannerLauncher } from '@/components/quick-deal-scanner-launcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { getAccountSecuritySettings, isMfaSatisfied } from '@/lib/security-services';

const navGroups = [
  {
    label: 'Today',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/assistant', label: 'AI Assistant', icon: Bot, featured: true },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { href: '/inventory', label: 'Inventory', icon: Package },
      { href: '/scan', label: 'Scan Intake', icon: ScanBarcode },
      { href: '/prep', label: 'Prep Workflow', icon: ClipboardList },
      { href: '/tasks', label: 'Tasks', icon: ClipboardCheck },
      { href: '/review', label: 'Review', icon: ClipboardCheck },
      { href: '/labels?manual=1', label: 'Labels', icon: Printer },
    ],
  },
  {
    label: 'Sell',
    items: [
      { href: '/planning', label: 'Lot Analyzer', icon: Target },
      { href: '/shows', label: 'Whatnot Shows', icon: ListChecks },
      { href: '/planning?tab=bundles', label: 'Bundles', icon: Boxes },
      { href: '/planning?tab=disputes', label: 'Disputes', icon: Gavel },
      { href: '/shipping', label: 'Shipping', icon: Truck },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/finance', label: 'Finance', icon: DollarSign },
      { href: '/insights', label: 'Reports', icon: Lightbulb },
      { href: '/documents', label: 'Documents', icon: FileLock2 },
    ],
  },
  {
    label: 'Admin',
    adminOnly: true,
    items: [
      { href: '/employees', label: 'Team', icon: Users },
    ],
  },
  {
    label: 'Support',
    items: [
      { href: '/help', label: 'Help / Manual', icon: BookOpen },
    ],
  },
];

const ALWAYS_OPEN_GROUPS = new Set(['Today', 'Inventory']);

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  featured?: boolean;
};

type NavGroup = {
  label: string;
  adminOnly?: boolean;
  items: NavItem[];
};

type SearchParamReader = {
  get: (key: string) => string | null;
};

function NavLink({ item, pathname, searchParams, onNavClick }: {
  item: NavItem;
  pathname: string;
  searchParams?: SearchParamReader;
  onNavClick?: () => void;
}) {
  const Icon = item.icon;
  const itemPath = item.href.split('?')[0];
  const hrefQuery = item.href.includes('?') ? new URLSearchParams(item.href.split('?')[1]) : null;
  const isQueryMatch = hrefQuery
    ? Array.from(hrefQuery.entries()).every(([key, value]) => searchParams?.get(key) === value)
    : true;
  const isActive = hrefQuery
    ? pathname === itemPath && isQueryMatch
    : item.href === '/planning'
    ? pathname === '/planning' && !searchParams?.get('tab')
    : pathname === itemPath || (itemPath !== '/dashboard' && pathname.startsWith(itemPath + '/'));

  if (item.featured) {
    return (
      <Link
        href={item.href}
        onClick={onNavClick}
        className={cn(
          'group relative flex items-center gap-3 rounded-xl border px-3 py-3 transition-all duration-150',
          isActive
            ? 'border-primary/35 bg-primary/[0.12] text-primary shadow-[0_16px_38px_-28px_hsl(148_100%_50%)]'
            : 'border-white/[0.07] bg-white/[0.025] text-white/65 hover:border-primary/25 hover:bg-primary/[0.06] hover:text-white/85'
        )}
      >
        <div className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border',
          isActive ? 'border-primary/30 bg-primary/15' : 'border-white/[0.08] bg-black/30'
        )}>
          <Icon className={cn('h-4 w-4', isActive ? 'text-primary' : 'text-white/45 group-hover:text-primary')} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-tight">{item.label}</div>
          <div className="mt-0.5 truncate text-[10px] text-white/35">Ask, analyze, curate</div>
        </div>
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5', isActive ? 'text-primary' : 'text-white/20')} />
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavClick}
      style={{ minHeight: 44 }}
      className={cn(
        'group relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-100',
        isActive
          ? 'bg-white/[0.07] text-white/92 shadow-[inset_0_0_0_1px_hsl(0_0%_100%/0.045)]'
          : 'text-white/46 hover:bg-white/[0.04] hover:text-white/78'
      )}
    >
      {isActive && (
        <div className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
      )}
      <Icon className={cn(
        'h-5 w-5 shrink-0 transition-colors',
        isActive ? 'text-primary' : 'text-white/28 group-hover:text-white/55'
      )} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SidebarContent({ pathname, searchParams, user, signOut, isAdmin, accountRole, onNavClick }: {
  pathname: string;
  searchParams?: SearchParamReader;
  user: any;
  signOut: () => void;
  isAdmin?: boolean;
  accountRole?: string | null;
  onNavClick?: () => void;
}) {
  const visibleNavGroups = (navGroups as NavGroup[])
    .filter((group) => !group.adminOnly || isAdmin)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.href !== '/settings' || isAdmin),
    }));
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const groupHasActiveItem = (group: NavGroup) =>
    group.items.some((item) => {
      const itemPath = item.href.split('?')[0];
      const hrefQuery = item.href.includes('?') ? new URLSearchParams(item.href.split('?')[1]) : null;
      const isQueryMatch = hrefQuery
        ? Array.from(hrefQuery.entries()).every(([key, value]) => searchParams?.get(key) === value)
        : true;
      return hrefQuery
        ? pathname === itemPath && isQueryMatch
        : item.href === '/planning'
        ? pathname === '/planning' && !searchParams?.get('tab')
        : pathname === itemPath || (itemPath !== '/dashboard' && pathname.startsWith(itemPath + '/'));
    });

  const isGroupOpen = (group: NavGroup) => {
    if (ALWAYS_OPEN_GROUPS.has(group.label)) return true;
    if (typeof openGroups[group.label] === 'boolean') return openGroups[group.label];
    return groupHasActiveItem(group);
  };

  return (
    <div className="flex h-full flex-col bg-black/90">
      <div className="border-b border-white/[0.06] px-5 pb-5 pt-6">
        <Link href="/dashboard" className="flex items-center gap-2.5" onClick={onNavClick}>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 shadow-[0_12px_30px_-22px_hsl(148_100%_50%)]">
            <Terminal className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-[15px] tracking-tight text-white/90">
              retro<span className="text-primary">loot</span><span className="ml-1 text-[10px] font-semibold uppercase tracking-widest text-primary/70">pro</span>
            </div>
            <div className="mt-0.5 text-[10px] font-medium text-white/28">Inventory command center</div>
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {visibleNavGroups.map((group, groupIndex) => (
          <div key={groupIndex} className="rounded-lg">
            {group.label && group.items.length > 0 && (
              <button
                type="button"
                style={{ minHeight: 40 }}
                className="group flex min-h-10 w-full items-center justify-between rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.035]"
                onClick={() => {
                  if (ALWAYS_OPEN_GROUPS.has(group.label)) return;
                  setOpenGroups((current) => ({ ...current, [group.label]: !isGroupOpen(group) }));
                }}
              >
                <span className="label-caps text-[10px]">{group.label}</span>
                {!ALWAYS_OPEN_GROUPS.has(group.label) && (
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-white/20 transition-transform group-hover:text-white/45',
                      isGroupOpen(group) && 'rotate-180'
                    )}
                  />
                )}
              </button>
            )}
            {isGroupOpen(group) && (
              <div className="mt-1 space-y-1">
                {group.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    searchParams={searchParams}
                    onNavClick={onNavClick}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="mt-auto space-y-2 border-t border-white/[0.06] px-3 pb-5 pt-3">
        <ThemeToggle />

        {isAdmin && (
          <Link
            href="/settings"
            onClick={onNavClick}
            style={{ minHeight: 44 }}
            className={cn(
              'group relative flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-100',
              pathname === '/settings'
                ? 'bg-white/[0.055] text-white/90'
                : 'text-white/42 hover:bg-white/[0.035] hover:text-white/75'
            )}
          >
            {pathname === '/settings' && (
              <div className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
            )}
            <Settings className={cn(
              'h-5 w-5 shrink-0',
              pathname === '/settings' ? 'text-primary' : 'text-white/28 group-hover:text-white/55'
            )} />
            <span>Settings</span>
          </Link>
        )}

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
          <div className="mb-2 truncate font-mono text-[10.5px] text-white/28">{user?.email}</div>
          {accountRole && (
            <div className="mb-2 w-fit rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-primary/75">
              {accountRole}
            </div>
          )}
          <button
            onClick={signOut}
            style={{ minHeight: 44 }}
            className="flex min-h-10 w-full items-center gap-2 rounded-xl px-2 text-sm font-medium text-white/45 transition-colors hover:bg-white/[0.035] hover:text-white/75"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function getActiveNavItem(pathname: string, searchParams?: SearchParamReader) {
  const allItems = (navGroups as NavGroup[]).flatMap((group) => group.items);
  return allItems.find((item) => {
    const itemPath = item.href.split('?')[0];
    const hrefQuery = item.href.includes('?') ? new URLSearchParams(item.href.split('?')[1]) : null;
    const isQueryMatch = hrefQuery
      ? Array.from(hrefQuery.entries()).every(([key, value]) => searchParams?.get(key) === value)
      : true;
    return hrefQuery
      ? pathname === itemPath && isQueryMatch
      : item.href === '/planning'
      ? pathname === '/planning' && !searchParams?.get('tab')
      : pathname === itemPath || (itemPath !== '/dashboard' && pathname.startsWith(itemPath + '/'));
  });
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut, isAdmin, accountRole } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeItem = getActiveNavItem(pathname, searchParams);
  const ActiveIcon = activeItem?.icon || LayoutDashboard;

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (loading || !user || !pathname) return;
    if (pathname === '/settings' || pathname.startsWith('/auth/')) return;

    let cancelled = false;
    (async () => {
      try {
        const settings = await getAccountSecuritySettings();
        if (!cancelled && settings?.require_mfa && !(await isMfaSatisfied())) {
          router.push('/settings?security=mfa');
        }
      } catch {
        // If security settings cannot load, keep the existing route guard behavior.
      }
    })();

    return () => { cancelled = true; };
  }, [loading, pathname, router, user]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="w-9 h-9 rounded-lg border border-primary/30 bg-primary/10 flex items-center justify-center animate-pulse">
          <Terminal className="w-4 h-4 text-primary" />
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen flex bg-[radial-gradient(circle_at_45%_-18%,hsl(148_100%_50%/0.08),transparent_26rem),linear-gradient(180deg,hsl(0_0%_1%),hsl(0_0%_0%))]">
      <aside className="hidden w-64 flex-shrink-0 flex-col border-r border-white/[0.06] bg-black/82 backdrop-blur-xl lg:flex">
        <SidebarContent pathname={pathname} searchParams={searchParams} user={user} signOut={signOut} isAdmin={isAdmin} accountRole={accountRole} />
      </aside>

      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 h-12 border-b border-white/[0.06] bg-black/95 backdrop-blur-sm flex items-center justify-between px-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-primary" />
          <span className="font-bold text-sm tracking-tight text-white/90">retro<span className="text-primary">loot</span><span className="ml-1 text-[9px] font-semibold tracking-widest text-primary/70 uppercase">pro</span></span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          <Button variant="ghost" size="icon" className="h-11 w-11 text-white/40 hover:bg-white/[0.05] hover:text-white/70" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {mobileOpen && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="fixed bottom-0 left-0 top-0 z-50 w-72 border-r border-white/[0.06] lg:hidden">
            <SidebarContent pathname={pathname} searchParams={searchParams} user={user} signOut={signOut} isAdmin={isAdmin} accountRole={accountRole} onNavClick={() => setMobileOpen(false)} />
          </div>
        </>
      )}

      <main className="flex-1 min-w-0 overflow-auto lg:pt-0 pt-12">
        <div className="sticky top-0 z-30 hidden border-b border-white/[0.06] bg-black/68 px-5 py-3 backdrop-blur-xl lg:block">
          <div className="mx-auto flex max-w-[1560px] items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.035]">
                <ActiveIcon className="h-[18px] w-[18px] text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white/88">{activeItem?.label || 'RetroLootPro'}</div>
                <div className="text-[11px] text-white/32">Fast command view for inventory, sales, and cash decisions</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href="/inventory"
                className="hidden h-9 items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 text-sm font-medium text-white/62 transition hover:bg-white/[0.055] hover:text-white/85 xl:flex"
              >
                <Search className="h-4 w-4 text-white/35" />
                Find Inventory
              </Link>
              <Link
                href="/assistant"
                className="hidden h-9 items-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.09] px-3 text-sm font-semibold text-primary transition hover:bg-primary/[0.13] xl:flex"
              >
                <Sparkles className="h-4 w-4" />
                Ask AI
              </Link>
              <ThemeToggle compact />
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-[1560px]">
          {children}
        </div>
      </main>

      <Link
        href="/pos"
        className="fixed bottom-20 right-5 z-40 flex h-14 items-center gap-2 rounded-full border border-primary/35 bg-primary px-5 text-sm font-bold text-black shadow-[0_12px_34px_-18px_hsl(148_100%_50%)] transition hover:scale-[1.02]"
      >
        <MonitorUp className="h-4 w-4" />
        POS
      </Link>
      <QuickDealScannerLauncher />
    </div>
  );
}
