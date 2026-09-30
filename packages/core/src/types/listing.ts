export type ListingStatus = 'active' | 'reserved' | 'sold' | 'expired' | 'cancelled';

export type TransactionStatus =
  | 'pending'
  | 'confirmed'
  | 'disputed'
  | 'resolved'
  | 'completed'
  | 'cancelled';

export interface ShippingOption {
  method: 'collection' | 'delivery' | 'both';
  deliveryRadiusMiles?: number;
  deliveryCostPence?: number;
  notes?: string;
}

export interface Listing {
  id: string;
  passportId: string;
  organisationId: string;
  sellerId: string;
  pricePence: number;
  currency: string;
  /** The lot size, in the passport's unit of measure. */
  quantity: number;
  /** What open and completed orders have not taken. */
  quantityAvailable: number;
  /** The smallest order a buyer may place (unless less than that is left). */
  minOrderQuantity: number;
  shippingOptions?: ShippingOption[];
  status: ListingStatus;
  expiresAt?: Date;
  blockchainTxHash?: string;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  /** How much of the lot this order takes. */
  quantity: number;
  /** The order total: unit price × quantity. */
  amountPence: number;
  status: TransactionStatus;
  disputeDeadline?: Date;
  blockchainTxHash?: string;
  createdAt: Date;
}
