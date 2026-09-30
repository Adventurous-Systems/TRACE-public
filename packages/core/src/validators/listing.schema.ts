import { z } from 'zod';

const ShippingOptionSchema = z.object({
  method: z.enum(['collection', 'delivery', 'both']),
  deliveryRadiusMiles: z.number().int().positive().optional(),
  deliveryCostPence: z.number().int().nonnegative().optional(),
  notes: z.string().max(500).optional(),
});

export const CreateListingSchema = z
  .object({
    passportId: z.string().uuid(),
    pricePence: z.number().int().positive(),
    currency: z.string().length(3).default('GBP'),
    quantity: z.number().int().positive().default(1),
    minOrderQuantity: z.number().int().positive().default(1),
    shippingOptions: z.array(ShippingOptionSchema).min(1),
    expiresAt: z.coerce.date().optional(),
  })
  .refine((l) => l.minOrderQuantity <= l.quantity, {
    message: 'The minimum order cannot be more than the quantity listed',
    path: ['minOrderQuantity'],
  });

export type CreateListingInput = z.infer<typeof CreateListingSchema>;

export const UpdateListingSchema = z.object({
  pricePence: z.number().int().positive().optional(),
  quantity: z.number().int().positive().optional(),
  minOrderQuantity: z.number().int().positive().optional(),
  shippingOptions: z.array(ShippingOptionSchema).min(1).optional(),
  expiresAt: z.coerce.date().optional(),
});

export type UpdateListingInput = z.infer<typeof UpdateListingSchema>;

export const MakeOfferSchema = z.object({
  listingId: z.string().uuid(),
  // How much of the lot to buy; defaults to the listing's minimum order.
  quantity: z.number().int().positive().optional(),
  offerPence: z.number().int().positive().optional(), // unit price; if absent, the asking price
  notes: z.string().max(500).optional(),
});

export type MakeOfferInput = z.infer<typeof MakeOfferSchema>;

export const MarketplaceQuerySchema = z.object({
  q: z.string().optional(),
  categoryL1: z.string().optional(),
  categoryL2: z.string().optional(),
  conditionGrade: z.enum(['A', 'B', 'C', 'D']).optional(),
  minPricePence: z.coerce.number().int().nonnegative().optional(),
  maxPricePence: z.coerce.number().int().nonnegative().optional(),
  hubSlug: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sortBy: z.enum(['createdAt', 'pricePence', 'carbonSavingsVsNew']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type MarketplaceQueryInput = z.infer<typeof MarketplaceQuerySchema>;

export const UpdateTransactionSchema = z.object({
  // Seller: accept | reject. Buyer: confirm_delivery | flag_dispute.
  // Either: cancel. Platform admin: resolve_dispute.
  action: z.enum([
    'accept',
    'reject',
    'confirm_delivery',
    'flag_dispute',
    'resolve_dispute',
    'cancel',
  ]),
  notes: z.string().max(1000).optional(),
  evidenceUrls: z.array(z.string().url()).optional(),
});

export type UpdateTransactionInput = z.infer<typeof UpdateTransactionSchema>;
