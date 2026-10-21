import { z } from 'zod';
import { addressSchema } from './storefront-model';

export const shippingCustomerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  address: addressSchema.extend({
    country: z.literal('US'),
    state: z.string().trim().regex(/^[A-Za-z]{2}$/, 'Use a two-letter US state code.').transform(value => value.toUpperCase()),
    postal_code: z.string().trim().regex(/^\d{5}(-\d{4})?$/, 'Enter a US ZIP code.'),
  }),
});

export const packageProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(100),
  platform: z.string().trim().max(100).default(''),
  condition: z.string().trim().max(100).default(''),
  unitWeightOz: z.number().positive().max(2400),
  packagingWeightOz: z.number().nonnegative().max(500),
  lengthIn: z.number().positive().max(108),
  widthIn: z.number().positive().max(108),
  heightIn: z.number().positive().max(108),
  unitsPerParcel: z.number().int().min(1).max(100),
});

export const shippingSettingsSchema = z.object({
  origin: shippingCustomerSchema,
  profiles: z.array(packageProfileSchema).min(1).max(100),
}).superRefine(({ profiles }, ctx) => {
  const selectors = profiles.map(p => JSON.stringify([p.category, p.platform, p.condition].map(s => s.toLowerCase())));
  if (new Set(selectors).size !== selectors.length || new Set(profiles.map(p => p.id)).size !== profiles.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Package profile names/selectors must not overlap exactly, and IDs must be unique.' });
  }
});

export type ShippingCustomer = z.infer<typeof shippingCustomerSchema>;
export type ShippingSettings = z.infer<typeof shippingSettingsSchema>;
export type PackageProfile = z.infer<typeof packageProfileSchema>;
export type ShippingRate = { id: string; name: string; amount: number; estimatedDays: number | null };
export type QuotedShipping = { customer: ShippingCustomer; rate: ShippingRate; parcels: number };
export type ShippingLine = { id: string; quantity: number; unit_amount: number; category: string; platform: string; condition: string; title: string };

export function shippingParcels(lines: ShippingLine[], profiles: PackageProfile[]) {
  const groups = new Map<string, { profile: PackageProfile; quantity: number }>();
  for (const line of lines) {
    const matches = profiles.filter(p => p.category.toLowerCase() === line.category.toLowerCase()
      && (!p.platform || p.platform.toLowerCase() === line.platform.toLowerCase())
      && (!p.condition || p.condition.toLowerCase() === line.condition.toLowerCase()));
    const score = (p: PackageProfile) => Number(!!p.platform) + Number(!!p.condition);
    matches.sort((a, b) => score(b) - score(a));
    if (!matches.length) throw new Error(`Shipping is not configured for ${line.title}. Please request this item or contact support.`);
    if (matches.length > 1 && score(matches[0]) === score(matches[1])) throw new Error(`Multiple package profiles match ${line.title}. Staff must resolve the overlap.`);
    const profile = matches[0];
    const group = groups.get(profile.id);
    groups.set(profile.id, { profile, quantity: (group?.quantity || 0) + line.quantity });
  }
  const parcels: { length: string; width: string; height: string; distance_unit: 'in'; weight: string; mass_unit: 'oz' }[] = [];
  for (const { profile: p, quantity } of Array.from(groups.values())) {
    for (let remaining = quantity; remaining > 0; remaining -= p.unitsPerParcel) {
      const weight = p.packagingWeightOz + Math.min(remaining, p.unitsPerParcel) * p.unitWeightOz;
      if (weight > 2400) throw new Error('A package exceeds the supported 150 lb limit. Contact support for a shipping quote.');
      parcels.push({ length: String(p.lengthIn), width: String(p.widthIn), height: String(p.heightIn), distance_unit: 'in', weight: weight.toFixed(3), mass_unit: 'oz' });
      if (parcels.length > 10) throw new Error('This cart needs more than 10 packages. Contact support for a shipping quote.');
    }
  }
  return parcels;
}
