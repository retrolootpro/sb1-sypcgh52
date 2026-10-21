import { supabase } from './supabase';
import {
  labEntrySchema, labInventorySchema, labLookupFilter, labSessionName,
  labSessionSchema, normalizeLabCode, type LabEntry, type LabSession,
} from './scanner-lab-model';

function throwLabError(error: { message: string; code?: string }) {
  if (['42P01', 'PGRST205'].includes(error.code || '')) {
    throw new Error('Scanner Lab storage is not installed in this environment. Apply the Scanner Lab migration before saving sessions.');
  }
  throw new Error(error.message);
}

export async function listLabSessions(accountId: string, userId: string) {
  const sessions: LabSession[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('scanner_lab_sessions')
      .select('id,name,created_at,closed_at')
      .eq('account_id', accountId).eq('created_by', userId)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + 499);
    if (error) throwLabError(error);
    const page = labSessionSchema.array().parse(data);
    sessions.push(...page);
    if (page.length < 500) return sessions;
  }
}

export async function createLabSession(accountId: string, userId: string, name: string) {
  const { data, error } = await supabase.from('scanner_lab_sessions')
    .insert({ account_id: accountId, created_by: userId, name: labSessionName(name) })
    .select('id,name,created_at,closed_at').single();
  if (error) throwLabError(error);
  return labSessionSchema.parse(data);
}

export async function closeLabSession(accountId: string, userId: string, sessionId: string) {
  const { data, error } = await supabase.from('scanner_lab_sessions')
    .update({ closed_at: new Date().toISOString() })
    .eq('id', sessionId).eq('account_id', accountId).eq('created_by', userId).is('closed_at', null)
    .select('id,name,created_at,closed_at').single();
  if (error) throwLabError(error);
  return labSessionSchema.parse(data);
}

export async function listLabEntries(accountId: string, userId: string, sessionId: string) {
  const entries: LabEntry[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('scanner_lab_entries')
      .select('id,code,created_at,inventory_snapshot')
      .eq('session_id', sessionId).eq('account_id', accountId).eq('created_by', userId)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + 499);
    if (error) throwLabError(error);
    const page = labEntrySchema.array().parse(data);
    entries.push(...page);
    if (page.length < 500) return entries;
  }
}

export async function scanToLabSession(accountId: string, userId: string, session: LabSession, rawCode: string) {
  if (session.closed_at) throw new Error('This session is closed. Start or select an open session to scan.');
  const code = normalizeLabCode(rawCode);
  const { data: matches, error: lookupError } = await supabase.from('inventory_items')
    .select('id,product_name,barcode,sku,console,condition,quantity,status,purchase_price,sell_price')
    .eq('user_id', accountId).or(labLookupFilter(code)).limit(51);
  if (lookupError) throwLabError(lookupError);
  if (matches && matches.length > 50) throw new Error('More than 50 inventory matches. Scan a more specific SKU.');
  const snapshot = labInventorySchema.array().parse(matches);
  const { data, error } = await supabase.from('scanner_lab_entries')
    .insert({ session_id: session.id, account_id: accountId, created_by: userId, code, inventory_snapshot: snapshot })
    .select('id,code,created_at,inventory_snapshot').single();
  if (error) throwLabError(error);
  return labEntrySchema.parse(data);
}
