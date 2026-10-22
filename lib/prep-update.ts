import { supabase } from '@/lib/supabase';

type PrepUpdate = Partial<Record<
  'sorted_at' | 'cleaned_at' | 'tested_at' | 'notes_added_at' | 'on_rack_at' |
  'listed_ebay_at' | 'listed_amazon_at' | 'listed_whatnot_at' | 'sold_at', string | null
>> & { status?: 'sold' | 'available'; sell_price?: number };

export async function savePrepUpdate(accountId: string, itemId: string, patch: PrepUpdate) {
  const { data, error } = await supabase.from('inventory_items')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', itemId).eq('user_id', accountId).select('id').single();
  if (error) throw error;
  if (!data) throw new Error('No inventory row was updated. Refresh and check your team access.');
}
