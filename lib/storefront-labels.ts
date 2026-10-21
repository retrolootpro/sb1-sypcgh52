import { z } from 'zod';

export const labelParcelSchema = z.object({
  length: z.number().positive().max(108),
  width: z.number().positive().max(108),
  height: z.number().positive().max(108),
  weight: z.number().positive().max(2400),
});
export type LabelParcel = z.infer<typeof labelParcelSchema>;
export type LabelRate = { id: string; name: string; amount: number; estimatedDays: number | null };
export type ShippingLabel = {
  id: string; order_id: string; parcel_index: number; status: 'purchasing' | 'pending' | 'success' | 'error' | 'unknown';
  rate: LabelRate; parcel: LabelParcel; transaction_id: string | null;
  label_url: string | null; tracking_number: string | null; tracking_url: string | null; message: string | null;
};
