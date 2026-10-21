import { z } from 'zod';

export const cartSchema = z.array(z.object({
  id: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
})).min(1).max(30).refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Duplicate cart items.');

export const addressSchema = z.object({
  line1: z.string().trim().min(1).max(150),
  line2: z.string().trim().max(150).default(''),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  postal_code: z.string().trim().min(1).max(20),
  country: z.string().regex(/^[A-Z]{2}$/),
});

export const requestSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  item: z.string().trim().min(3).max(200),
  platform: z.string().trim().max(100).default(''),
  notes: z.string().trim().max(2000).default(''),
  address: addressSchema,
  website: z.string().max(0).default(''),
});

export function parseSavedCart(value: string | null): Record<string, number> {
  if (!value) return {};
  const result = z.record(z.number().int().positive().max(20)).safeParse(JSON.parse(value));
  if (!result.success) throw new Error('Saved cart is invalid. Please clear it and add the items again.');
  return result.data;
}
