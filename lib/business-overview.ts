import { z } from 'zod';

export const businessOverviewSchema = z.object({
  readyToShip: z.number().int().nonnegative(),
  awaitingPayment: z.number().int().nonnegative(),
  shipped: z.number().int().nonnegative(),
  openRequests: z.number().int().nonnegative(),
  orders: z.array(z.object({
    id: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
    shippingService: z.string().nullable(),
  })).max(5),
});

export type BusinessOverview = z.infer<typeof businessOverviewSchema>;
