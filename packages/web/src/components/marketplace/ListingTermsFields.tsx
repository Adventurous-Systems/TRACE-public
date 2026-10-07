'use client';

import { BUSINESS_TIME_ZONE, endOfDayInLondon, perUnit, unitLabel } from '@trace/core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import type { ListingSummary } from '@/lib/api-client';

export type ShippingMethod = 'collection' | 'delivery' | 'both';

/** A lot's terms as the form holds them: what the seller types. */
export interface ListingTerms {
  pricePounds: string;
  quantity: string;
  minOrderQuantity: string;
  shippingMethod: ShippingMethod;
  deliveryCostPounds: string;
  deliveryRadiusMiles: string;
  shippingNotes: string;
  /** A day in the UK, YYYY-MM-DD; '' for no expiry. */
  expiresAt: string;
}

export const EMPTY_TERMS: ListingTerms = {
  pricePounds: '',
  quantity: '1',
  minOrderQuantity: '1',
  shippingMethod: 'collection',
  deliveryCostPounds: '',
  deliveryRadiusMiles: '',
  shippingNotes: '',
  expiresAt: '',
};

/** A date as the day it falls on in the UK ('en-CA' formats as YYYY-MM-DD). */
export function ukDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE }).format(date);
}

const pounds = (pence: number | undefined) => (pence === undefined ? '' : (pence / 100).toFixed(2));

/** An existing lot's terms, to fill the edit form. */
export function termsFromListing(listing: ListingSummary): ListingTerms {
  const shipping = listing.shippingOptions[0];
  return {
    pricePounds: pounds(listing.pricePence),
    quantity: String(listing.quantity),
    minOrderQuantity: String(listing.minOrderQuantity),
    shippingMethod: (shipping?.method as ShippingMethod | undefined) ?? 'collection',
    deliveryCostPounds: pounds(shipping?.deliveryCostPence),
    deliveryRadiusMiles:
      shipping?.deliveryRadiusMiles !== undefined ? String(shipping.deliveryRadiusMiles) : '',
    shippingNotes: shipping?.notes ?? '',
    expiresAt: listing.expiresAt ? ukDay(new Date(listing.expiresAt)) : '',
  };
}

/** Checks the browser can't make with input attributes alone; null when fine. */
export function termsError(terms: ListingTerms): string | null {
  const price = parseFloat(terms.pricePounds);
  if (!terms.pricePounds || isNaN(price) || price <= 0) return 'Enter a valid price';
  return null;
}

export function pricePence(terms: ListingTerms): number {
  return Math.round(parseFloat(terms.pricePounds) * 100);
}

export function shippingOptionOf(terms: ListingTerms): Record<string, unknown> {
  const option: Record<string, unknown> = { method: terms.shippingMethod };
  if (terms.shippingNotes) option['notes'] = terms.shippingNotes;
  if (terms.shippingMethod === 'delivery' || terms.shippingMethod === 'both') {
    if (terms.deliveryCostPounds) {
      option['deliveryCostPence'] = Math.round(parseFloat(terms.deliveryCostPounds) * 100);
    }
    if (terms.deliveryRadiusMiles) {
      option['deliveryRadiusMiles'] = parseInt(terms.deliveryRadiusMiles, 10);
    }
  }
  return option;
}

/** The end of the chosen day in the UK, not midnight UTC at its start (R5). */
export function expiryOf(terms: ListingTerms): string | null {
  return terms.expiresAt ? endOfDayInLondon(terms.expiresAt).toISOString() : null;
}

const SHIPPING_KEYS: Array<keyof ListingTerms> = [
  'shippingMethod',
  'deliveryCostPounds',
  'deliveryRadiusMiles',
  'shippingNotes',
];

/**
 * Only what the seller changed, so an edit never rewrites a field nobody
 * touched (a lot made elsewhere may have more than one shipping option).
 */
export function changedTerms(before: ListingTerms, after: ListingTerms): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (before.pricePounds !== after.pricePounds) body['pricePence'] = pricePence(after);
  if (before.quantity !== after.quantity) body['quantity'] = parseInt(after.quantity, 10) || 1;
  if (before.minOrderQuantity !== after.minOrderQuantity) {
    body['minOrderQuantity'] = parseInt(after.minOrderQuantity, 10) || 1;
  }
  if (SHIPPING_KEYS.some((k) => before[k] !== after[k])) {
    body['shippingOptions'] = [shippingOptionOf(after)];
  }
  if (before.expiresAt !== after.expiresAt) body['expiresAt'] = expiryOf(after);
  return body;
}

interface Props {
  terms: ListingTerms;
  onChange: (terms: ListingTerms) => void;
  /** The passport's unit of measure, when the material is known. */
  unit?: string | null | undefined;
  /** Shown under the quantity: what bounds it on an existing lot. */
  quantityHint?: React.ReactNode | undefined;
  /** Shown under the price: what a change does on an existing lot. */
  priceHint?: React.ReactNode | undefined;
}

/** Price, quantity, minimum, expiry and shipping: shared by "New listing" and "Edit listing". */
export function ListingTermsFields({ terms, onChange, unit, quantityHint, priceHint }: Props) {
  const set = (patch: Partial<ListingTerms>) => onChange({ ...terms, ...patch });
  const inUnit = unit && unit !== 'each' ? ` (${unitLabel(unit)})` : '';
  const delivers = terms.shippingMethod === 'delivery' || terms.shippingMethod === 'both';

  return (
    <>
      <Card>
        <CardContent className="p-5 space-y-4">
          <h2 className="font-semibold text-sm text-gray-700">Pricing</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="price">
                {unit ? `Price ${perUnit(unit)} (£) *` : 'Price per unit (£) *'}
              </Label>
              <Input
                id="price"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={terms.pricePounds}
                onChange={(e) => set({ pricePounds: e.target.value })}
                required
              />
              {priceHint && <p className="text-xs text-gray-500">{priceHint}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quantity">Quantity in this lot{inUnit}</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                value={terms.quantity}
                onChange={(e) => set({ quantity: e.target.value })}
              />
              {quantityHint && <p className="text-xs text-gray-500">{quantityHint}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="min-order">Minimum order{inUnit}</Label>
              <Input
                id="min-order"
                type="number"
                min="1"
                value={terms.minOrderQuantity}
                onChange={(e) => set({ minOrderQuantity: e.target.value })}
              />
              <p className="text-xs text-gray-500">
                Buyers order any amount from this up to what is left.
                {unit ? '' : " Price and quantity use the passport's unit of measure."}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="expires">Listing expires (optional)</Label>
            <Input
              id="expires"
              type="date"
              value={terms.expiresAt}
              onChange={(e) => set({ expiresAt: e.target.value })}
              min={ukDay(new Date())}
            />
            <p className="text-xs text-gray-500">
              On sale until the end of that day, UK time. Leave it empty for no end date.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-4">
          <h2 className="font-semibold text-sm text-gray-700">Shipping / collection *</h2>

          <div className="space-y-1.5">
            <Label>Method</Label>
            <div className="flex gap-3">
              {(['collection', 'delivery', 'both'] as const).map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="shipping"
                    value={m}
                    checked={terms.shippingMethod === m}
                    onChange={() => set({ shippingMethod: m })}
                  />
                  <span className="capitalize">{m}</span>
                </label>
              ))}
            </div>
          </div>

          {delivers && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="deliveryCost">Delivery cost (£)</Label>
                <Input
                  id="deliveryCost"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00 = free"
                  value={terms.deliveryCostPounds}
                  onChange={(e) => set({ deliveryCostPounds: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="radius">Delivery radius (miles)</Label>
                <Input
                  id="radius"
                  type="number"
                  min="1"
                  placeholder="e.g. 50"
                  value={terms.deliveryRadiusMiles}
                  onChange={(e) => set({ deliveryRadiusMiles: e.target.value })}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="shippingNotes">Notes (optional)</Label>
            <Input
              id="shippingNotes"
              placeholder="e.g. forklift required for collection"
              value={terms.shippingNotes}
              onChange={(e) => set({ shippingNotes: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
