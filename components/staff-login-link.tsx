'use client';

import Link from 'next/link';
import { LogIn, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export function StaffLoginLink() {
  const { user, accountId, loading } = useAuth();
  const staff = !loading && user && accountId;
  return <Link href={staff ? '/business' : '/login'} className="staff-login-link">
    {staff ? <LayoutDashboard/> : <LogIn/>}<span>{staff ? 'Business workspace' : 'Login'}</span>
  </Link>;
}
