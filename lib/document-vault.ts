import { supabase } from './supabase';
import { getActiveAccountId } from './account';

export type BusinessDocument = {
  id: string;
  user_id: string;
  uploaded_by: string | null;
  title: string;
  document_type: string;
  storage_path: string;
  original_file_name: string;
  mime_type: string | null;
  encrypted_size: number | null;
  encryption_version: string;
  encryption_salt: string;
  encryption_iv: string;
  visibility: 'team' | 'admin';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function safeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'document';
}

export async function listBusinessDocuments(): Promise<BusinessDocument[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(user);

  const { data, error } = await supabase
    .from('business_documents')
    .select('*')
    .eq('user_id', accountId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as BusinessDocument[];
}

export async function uploadEncryptedBusinessDocument(input: {
  file: File;
  title: string;
  documentType: string;
  notes?: string;
  visibility: 'team' | 'admin';
  passphrase: string;
}): Promise<void> {
  if (!input.passphrase || input.passphrase.length < 12) {
    throw new Error('Use a vault passphrase with at least 12 characters.');
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(user);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(input.passphrase, salt);
  const plaintext = await input.file.arrayBuffer();
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const storagePath = `${accountId}/${Date.now()}-${crypto.randomUUID()}-${safeName(input.file.name)}.enc`;
  const encryptedBlob = new Blob([encrypted], { type: 'application/octet-stream' });

  const { error: uploadError } = await supabase.storage
    .from('business-documents')
    .upload(storagePath, encryptedBlob, {
      cacheControl: '0',
      contentType: 'application/octet-stream',
      upsert: false,
    });
  if (uploadError) throw new Error(uploadError.message);

  const { error: dbError } = await supabase.from('business_documents').insert({
    user_id: accountId,
    uploaded_by: user.id,
    title: input.title.trim(),
    document_type: input.documentType,
    storage_path: storagePath,
    original_file_name: input.file.name,
    mime_type: input.file.type || null,
    encrypted_size: encryptedBlob.size,
    encryption_salt: bytesToBase64(salt),
    encryption_iv: bytesToBase64(iv),
    visibility: input.visibility,
    notes: input.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  });
  if (dbError) {
    await supabase.storage.from('business-documents').remove([storagePath]);
    throw new Error(dbError.message);
  }
}

export async function downloadEncryptedBusinessDocument(doc: BusinessDocument, passphrase: string): Promise<Blob> {
  if (!passphrase) throw new Error('Enter the vault passphrase to decrypt this document.');
  const { data, error } = await supabase.storage.from('business-documents').download(doc.storage_path);
  if (error || !data) throw new Error(error?.message || 'Could not download encrypted document');

  const key = await deriveKey(passphrase, base64ToBytes(doc.encryption_salt));
  const encrypted = await data.arrayBuffer();
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(doc.encryption_iv) }, key, encrypted);
  return new Blob([plaintext], { type: doc.mime_type || 'application/octet-stream' });
}

export async function deleteBusinessDocument(doc: BusinessDocument): Promise<void> {
  const [{ error: removeError }, { error: dbError }] = await Promise.all([
    supabase.storage.from('business-documents').remove([doc.storage_path]),
    supabase.from('business_documents').delete().eq('id', doc.id),
  ]);
  if (removeError) throw new Error(removeError.message);
  if (dbError) throw new Error(dbError.message);
}
