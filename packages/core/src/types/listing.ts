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
  quantity: number;
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
  amountPence: number;
  status: TransactionStatus;
  disputeDeadline?: Date;
  blockchainTxHash?: string;
  createdAt: Date;
}
