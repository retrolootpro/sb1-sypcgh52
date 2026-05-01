'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function AmazonCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connecting your Amazon Seller account...');

  useEffect(() => {
    const code = searchParams.get('spapi_oauth_code');
    const sellingPartnerId = searchParams.get('selling_partner_id');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      setMessage('Amazon authorization was cancelled or denied.');
      setTimeout(() => router.push('/settings?amazon=error'), 2500);
      return;
    }

    if (!code) {
      setStatus('error');
      setMessage('No authorization code received from Amazon.');
      setTimeout(() => router.push('/settings?amazon=error'), 2500);
      return;
    }

    const redirectUri = typeof window !== 'undefined'
      ? `${window.location.origin}/auth/amazon/callback`
      : '';

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setStatus('error');
          setMessage('Session expired. Please log in again.');
          setTimeout(() => router.push('/'), 2500);
          return;
        }

        const { data, error: fnError } = await supabase.functions.invoke('amazon-auth', {
          body: { action: 'exchange', code, redirect_uri: redirectUri, selling_partner_id: sellingPartnerId },
        });

        if (fnError || data?.error) {
          setStatus('error');
          setMessage(data?.error || fnError?.message || 'Failed to connect Amazon account.');
          setTimeout(() => router.push('/settings?amazon=error'), 2500);
          return;
        }

        setStatus('success');
        setMessage('Amazon Seller account connected successfully!');
        setTimeout(() => router.push('/settings?amazon=connected'), 2000);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unexpected error';
        setStatus('error');
        setMessage(msg);
        setTimeout(() => router.push('/settings?amazon=error'), 2500);
      }
    })();
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4 max-w-sm px-6">
        {status === 'loading' && (
          <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto" />
        )}
        {status === 'success' && (
          <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
            <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        {status === 'error' && (
          <div className="w-10 h-10 rounded-full bg-destructive/15 border border-destructive/30 flex items-center justify-center mx-auto">
            <svg className="w-5 h-5 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )}
        <p className="text-sm text-muted-foreground">{message}</p>
        <p className="text-xs text-muted-foreground/50">Redirecting you back to Settings...</p>
      </div>
    </div>
  );
}
