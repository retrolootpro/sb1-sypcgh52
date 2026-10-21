import { z } from 'zod';

export const labInventorySchema = z.object({
  id: z.string().uuid(),
  product_name: z.string(),
  barcode: z.string().nullable(),
  sku: z.string().nullable(),
  console: z.string().nullable(),
  condition: z.string().nullable(),
  quantity: z.number().nullable(),
  status: z.string().nullable(),
  purchase_price: z.number().nullable(),
  sell_price: z.number().nullable(),
});

export type LabInventoryItem = z.infer<typeof labInventorySchema>;

export const labSessionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  created_at: z.string(),
  closed_at: z.string().nullable(),
});

export type LabSession = z.infer<typeof labSessionSchema>;

export const labEntrySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  created_at: z.string(),
  inventory_snapshot: z.array(labInventorySchema).max(50),
});

export type LabEntry = z.infer<typeof labEntrySchema>;

export function normalizeLabCode(value: string): string {
  const code = value.trim();
  if (!code || code.length > 100 || /[\u0000-\u001f\u007f]/.test(code)) {
    throw new Error('Enter a barcode or SKU between 1 and 100 characters without control characters.');
  }
  return code;
}

export function labSessionName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 100) {
    throw new Error('Enter a session name between 1 and 100 characters.');
  }
  return name;
}

export function labLookupFilter(value: string): string {
  // Quote PostgREST values so punctuation in a SKU cannot change the filter.
  const literal = normalizeLabCode(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `barcode.eq."${literal}",sku.eq."${literal}"`;
}
