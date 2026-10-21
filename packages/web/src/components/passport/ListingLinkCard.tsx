import Link from 'next/link';
import { Store } from 'lucide-react';
import { perUnit } from '@trace/core';
import type { PassportListing } from '@/lib/api-client';
import { formatDate, formatPrice } from '@/lib/format';

/**
 * The way from a passport back to the marketplace: its price and a link to
 * its listing. A passport opened from a QR code otherwise had no way to the
 * material it describes (journey audit, 2026-10-13).
 */
export function ListingLinkCard({
  listing,
  unitOfMeasure,
}: {
  listing: PassportListing | null | undefined;
  unitOfMeasure: string | null;
}) {
  if (!listing) return null;
  const price = `${formatPrice(listing.pricePence)}${unitOfMeasure ? ` ${perUnit(unitOfMeasure)}` : ''}`;
  const state =
    listing.status === 'sold'
      ? 'Sold through the marketplace'
      : listing.status === 'reserved'
        ? 'On the marketplace, fully ordered for now'
        : 'On the marketplace';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4">
      <div className="flex items-center gap-3">
        <Store className="h-5 w-5 shrink-0 text-brand-600" aria-hidden />
        <div>
          <p className="text-sm font-medium text-gray-900">{state}</p>
          <p className="text-xs text-gray-600">
            {listing.status === 'sold' ? `Was ${price}` : price} · listed{' '}
            {formatDate(listing.listedAt)}
          </p>
        </div>
      </div>
      <Link
        href={`/marketplace/${listing.id}`}
        className="text-sm font-medium text-brand-700 hover:underline"
      >
        {listing.status === 'sold' ? 'See the listing →' : 'View listing →'}
      </Link>
    </div>
  );
}
