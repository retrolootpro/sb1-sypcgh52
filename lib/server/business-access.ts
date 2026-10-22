import type { User } from '@supabase/supabase-js';
import { createSupabaseAdmin } from './supabase-admin';

export async function businessAccountId() {
  const { data, error } = await createSupabaseAdmin().from('storefront_settings')
    .select('user_id').eq('public_slug', 'pixel-and-page').eq('is_active', true).single();
  if (error) throw error;
  if (!data?.user_id) throw new Error('Pixel & Page business account is not configured.');
  return String(data.user_id);
}

export async function businessMembership(user: User) {
  const accountId = await businessAccountId();
  const { data, error } = await createSupabaseAdmin().from('user_account_memberships')
    .select('id, account_owner_id, user_id, email, role, status, invited_at, accepted_at')
    .eq('account_owner_id', accountId).eq('user_id', user.id).eq('status', 'active').maybeSingle();
  if (error) throw error;
  if (!data || (data.role !== 'admin' && data.role !== 'user')) return null;
  return { accountId, accountRole: data.role as 'admin' | 'user', membership: data };
}
