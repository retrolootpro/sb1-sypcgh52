'use client';

import { useAuth } from '@/lib/auth-context';
import { useRouter, usePathname } from 'next/navigation';
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
  Target,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { QuickDealScannerLauncher } from '@/components/quick-deal-scanner-launcher';

const navGroups = [
  {
    label: 'Command',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/assistant', label: 'AI Assistant', icon: Bot, featured: true },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { href: '/inventory', label: 'Inventory', icon: Package },
      { href: '/scan', label: 'Scan', icon: ScanBarcode },
      { href: '/prep', label: 'Prep', icon: ClipboardList },
      { href: '/tasks', label: 'Tasks', icon: ClipboardCheck },
      { href: '/review', label: 'Review', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Sales',
    items: [
      { href: '/shows', label: 'Shows', icon: ListChecks },
      { href: '/finance', label: 'Finance', icon: DollarSign },
      { href: '/planning', label: 'Planning', icon: Target },
      { href: '/insights', label: 'Insights', icon: Lightbulb },
    ],
  },
  {
    label: 'Admin',
    adminOnly: true,
    items: [
      { href: '/employees', label: 'Team', icon: Users },
      { href: '/shipping', label: 'Shipping', icon: Truck },
    ],
  },
];

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

function NavLink({ item, pathname, onNavClick }: {
  item: NavItem;
  pathname: string;
  onNavClick?: () => void;
}) {
  const Icon = item.icon;
  const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));

  if (item.featured) {
    return (
      <Link
        href={item.href}
        onClick={onNavClick}
        className={cn(
          'group relative flex items-center gap-3 rounded-lg border px-3 py-3 transition-all duration-150',
          isActive
            ? 'border-primary/35 bg-primary/[0.12] text-primary shadow-[0_0_22px_-14px_hsl(148_100%_50%)]'
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
      className={cn(
        'group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-all duration-100',
        isActive
          ? 'bg-white/[0.055] text-white/90'
          : 'text-white/42 hover:bg-white/[0.035] hover:text-white/75'
      )}
    >
      {isActive && (
        <div className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
      )}
      <Icon className={cn(
        'h-[16px] w-[16px] shrink-0 transition-colors',
        isActive ? 'text-primary' : 'text-white/28 group-hover:text-white/55'
      )} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SidebarContent({ pathname, user, signOut, isAdmin, accountRole, onNavClick }: {
  pathname: string;
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

  return (
    <div className="flex h-full flex-col bg-black">
      <div className="border-b border-white/[0.06] px-5 pb-5 pt-6">
        <Link href="/dashboard" className="flex items-center gap-2.5" onClick={onNavClick}>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
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

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {visibleNavGroups.map((group, groupIndex) => (
          <div key={groupIndex}>
            {group.label && (
              <div className="label-caps mb-2 px-2 text-[9.5px]">{group.label}</div>
            )}
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  onNavClick={onNavClick}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-auto space-y-2 border-t border-white/[0.06] px-3 pb-5 pt-3">
        {isAdmin && (
          <Link
            href="/settings"
            onClick={onNavClick}
            className={cn(
              'group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-all duration-100',
              pathname === '/settings'
                ? 'bg-white/[0.055] text-white/90'
                : 'text-white/42 hover:bg-white/[0.035] hover:text-white/75'
            )}
          >
            {pathname === '/settings' && (
              <div className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
            )}
            <Settings className={cn(
              'h-[16px] w-[16px] shrink-0',
              pathname === '/settings' ? 'text-primary' : 'text-white/28 group-hover:text-white/55'
            )} />
            <span>Settings</span>
          </Link>
        )}

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <div className="mb-2 truncate font-mono text-[10.5px] text-white/28">{user?.email}</div>
          {accountRole && (
            <div className="mb-2 w-fit rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-primary/75">
              {accountRole}
            </div>
          )}
          <button
            onClick={signOut}
            className="flex items-center gap-2 text-[12px] text-white/38 transition-colors hover:text-white/70"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut, isAdmin, accountRole } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

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
    <div className="min-h-screen flex bg-black">
      <aside className="hidden w-60 flex-shrink-0 flex-col border-r border-white/[0.06] lg:flex">
        <SidebarContent pathname={pathname} user={user} signOut={signOut} isAdmin={isAdmin} accountRole={accountRole} />
      </aside>

      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 h-12 border-b border-white/[0.06] bg-black/95 backdrop-blur-sm flex items-center justify-between px-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-primary" />
          <span className="font-bold text-sm tracking-tight text-white/90">retro<span className="text-primary">loot</span><span className="ml-1 text-[9px] font-semibold tracking-widest text-primary/70 uppercase">pro</span></span>
        </Link>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-white/40 hover:text-white/70 hover:bg-white/[0.05]" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </Button>
      </div>

      {mobileOpen && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="fixed bottom-0 left-0 top-0 z-50 w-72 border-r border-white/[0.06] lg:hidden">
            <SidebarContent pathname={pathname} user={user} signOut={signOut} isAdmin={isAdmin} accountRole={accountRole} onNavClick={() => setMobileOpen(false)} />
          </div>
        </>
      )}

      <main className="flex-1 min-w-0 overflow-auto lg:pt-0 pt-12">
        {children}
      </main>

      <QuickDealScannerLauncher />
    </div>
  );
}
