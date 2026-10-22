'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, LockKeyhole, PackageCheck, ScanBarcode, ChartNoAxesCombined } from 'lucide-react';
import { AuthForm } from '@/components/auth-form';
import { useAuth } from '@/lib/auth-context';
import { staffReturnPath } from '@/lib/business-routes';

export default function LoginPage() {
  const { user, loading, accountId, accessError, refreshAccount, signOut } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = staffReturnPath(params.get('next'));
  useEffect(() => {
    if (!loading && user && accountId) router.replace(next);
  }, [loading, user, accountId, router, next]);
  return <main className="staff-login-page">
    <Link href="/" className="staff-back-link"><ArrowLeft size={16}/> Back to the shop</Link>
    <div className="staff-login-grid">
      <section className="staff-login-story">
        <Image src="/storefront/pixel-page-wordmark.png" width={320} height={64} alt="Pixel & Page" priority unoptimized/>
        <p className="brand-eyebrow">THE BUSINESS BEHIND THE STORIES</p>
        <h1>A good day starts<br/>with everything in place.</h1>
        <p>One workspace for the inventory, orders, and everyday work that brings Pixel &amp; Page to life.</p>
        <ul><li><PackageCheck/>Keep every order moving</li><li><ScanBarcode/>Turn new finds into ready-to-shop inventory</li><li><ChartNoAxesCombined/>See the business clearly</li></ul>
        <span className="staff-story-footer">Play. Read. Collect. Repeat.</span>
      </section>
      <section className="staff-login-card" aria-label="Staff sign in">
        <div className="staff-lock-mark"><LockKeyhole size={24}/></div>
        <p className="brand-eyebrow">PIXEL &amp; PAGE BUSINESS</p>
        <h2>Welcome back.</h2><p className="staff-login-intro">Sign in to your team workspace.</p>
        {loading || (user && accountId) ? <p role="status">Verifying your team access...</p>
          : user ? <div><p role="alert" className="staff-access-error">{accessError || 'Active team access is required.'}</p><button className="brand-button" onClick={refreshAccount}>Retry access check</button><button className="staff-text-button" onClick={signOut}>Sign out and use another login</button></div>
          : <><AuthForm/>{accessError && <p role="alert" className="staff-access-error">{accessError}</p>}</>}
        <div className="staff-customer-note"><strong>Here to shop?</strong> No account is needed to order. <Link href="/">Visit the storefront</Link> or <Link href="/shop/account">get order support</Link>.</div>
      </section>
    </div>
    <footer className="staff-login-footer">Pixel &amp; Page, LLC · Private team workspace</footer>
  </main>;
}
