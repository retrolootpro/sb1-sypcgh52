import { SupabaseClient, User } from '@supabase/supabase-js';
import { businessMembership } from './server/business-access';

export type ServerAccountContext = { accountId: string; role: 'admin' | 'user' };

export async function getServerAccountContext(_supabase: SupabaseClient, user: User): Promise<ServerAccountContext> {
  const account = await businessMembership(user);
  if (!account) throw new Error('Active Pixel & Page team access is required.');
  return { accountId: account.accountId, role: account.accountRole };
}
