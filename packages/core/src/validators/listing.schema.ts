import { z } from 'zod';
import { DISPUTE_OUTCOMES, MAX_AMOUNT_PENCE, MAX_LOT_QUANTITY } from '../constants/config.js';

const ShippingOptionSchema = z.object({
  method: z.enum(['collection', 'delivery', 'both']),
  deliveryRadiusMiles: z.number().int().positive().optional(),
  deliveryCostPence: z.number().int().nonnegative().optional(),
  notes: z.string().max(500).optional(),
});

// An expiry already passed would make a listing that is expired on arrival (R5).
const FutureDate = z.coerce
  .date()
  .refine((date) => date.getTime() > Date.now(), { message: 'The expiry date has already passed' });

export const CreateListingSchema = z
  .object({
    passportId: z.string().uuid(),
    pricePence: z.number().int().positive().max(MAX_AMOUNT_PENCE),
    currency: z.string().length(3).default('GBP'),
    quantity: z.number().int().positive().max(MAX_LOT_QUANTITY).default(1),
    minOrderQuantity: z.number().int().positive().max(MAX_LOT_QUANTITY).default(1),
    shippingOptions: z.array(ShippingOptionSchema).min(1),
    expiresAt: FutureDate.optional(),
  })
  .refine((l) => l.minOrderQuantity <= l.quantity, {
    message: 'The minimum order cannot be more than the quantity listed',
    path: ['minOrderQuantity'],
  });

export type CreateListingInput = z.infer<typeof CreateListingSchema>;

export const UpdateListingSchema = z.object({
  pricePence: z.number().int().positive().max(MAX_AMOUNT_PENCE).optional(),
  quantity: z.number().int().positive().max(MAX_LOT_QUANTITY).optional(),
  minOrderQuantity: z.number().int().positive().max(MAX_LOT_QUANTITY).optional(),
  shippingOptions: z.array(ShippingOptionSchema).min(1).optional(),
  // null clears the date: the listing no longer expires (D3).
  expiresAt: FutureDate.nullable().optional(),
});

export type UpdateListingInput = z.infer<typeof UpdateListingSchema>;

export const MakeOfferSchema = z.object({
  listingId: z.string().uuid(),
  // How much of the lot to buy; defaults to the listing's minimum order. The
  // price is the listing's asking price: buyers cannot name their own until
  // offers are a designed feature (owner decision, 2026-10-02).
  quantity: z.number().int().positive().max(MAX_LOT_QUANTITY).optional(),
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

export const UpdateTransactionSchema = z
  .object({
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
    /** What the person says about this step. Required to flag and to resolve. */
    notes: z.string().trim().max(1000).optional(),
    /** resolve_dispute only: the sale stands, or the order is cancelled. */
    outcome: z.enum(DISPUTE_OUTCOMES).optional(),
    evidenceUrls: z.array(z.string().url()).optional(),
  })
  .superRefine((value, ctx) => {
    const said = (value.notes ?? '').length >= 5;
    if (value.action === 'flag_dispute' && !said) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['notes'],
        message: 'Say what the problem is, so the seller and the platform can act on it',
      });
    }
    if (value.action === 'resolve_dispute') {
      if (!value.outcome) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['outcome'],
          message: 'Choose an outcome: the sale stands, or the order is cancelled',
        });
      }
      if (!said) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['notes'],
          message: 'Say why, for the buyer and the seller',
        });
      }
    }
  });

export type UpdateTransactionInput = z.infer<typeof UpdateTransactionSchema>;
