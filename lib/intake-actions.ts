import { supabase } from '@/lib/supabase';

export async function undoIntakeItem(accountId: string, itemId: string) {
  const { data, error } = await supabase.from('inventory_items').delete()
    .eq('user_id', accountId).eq('id', itemId)
    .eq('status', 'available').is('sold_at', null).is('lot_id', null)
    .select('id').single();
  if (error) throw error;
  if (!data) throw new Error('No eligible item was removed. Review inventory before retrying.');
}
