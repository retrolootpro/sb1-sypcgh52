import { supabase } from './supabase';
import { getActiveAccountId } from './account';

export type AccountSecuritySettings = {
  user_id: string;
  require_mfa: boolean;
  allowed_mfa_methods: string[];
  passkeys_enabled: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function getAccountSecuritySettings(): Promise<AccountSecuritySettings | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(user);

  const { data, error } = await supabase
    .from('account_security_settings')
    .select('*')
    .eq('user_id', accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as AccountSecuritySettings | null;
}

export async function upsertAccountSecuritySettings(input: {
  require_mfa: boolean;
  allowed_mfa_methods: string[];
  passkeys_enabled?: boolean;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(user);

  const { error } = await supabase
    .from('account_security_settings')
    .upsert({
      user_id: accountId,
      require_mfa: input.require_mfa,
      allowed_mfa_methods: input.allowed_mfa_methods,
      passkeys_enabled: Boolean(input.passkeys_enabled),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

export async function getAssuranceLevel(): Promise<'aal1' | 'aal2' | null> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return null;
  return (data?.currentLevel || null) as 'aal1' | 'aal2' | null;
}

export async function isMfaSatisfied(): Promise<boolean> {
  const level = await getAssuranceLevel();
  return level === 'aal2';
}
