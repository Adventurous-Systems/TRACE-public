'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { marketplace, type ListingSummary } from '@/lib/api-client';
import { unitLabel } from '@trace/core';
import { getToken, getUser, type StoredUser } from '@/lib/auth';
import { categoryLabel, subcategoryLabel } from '@/lib/categories';
import { getErrorMessage } from '@/lib/api-errors';
import { track, priceBand } from '@/lib/analytics';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/ui/Logo';

function formatPrice(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

export default function ListingDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [listing, setListing] = useState<ListingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [offerLoading, setOfferLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [user, setUser] = useState<StoredUser | null>(null);

  useEffect(() => {
    // Resolve auth state client-side (avoids a hydration mismatch for the CTA).
    setUser(getUser());
    marketplace
      .getListing(params.id)
      .then(setListing)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [params.id]);

  async function handleMakeOffer() {
    const token = getToken();
    const user = getUser();

    if (!token || !user) {
      router.push(`/login?next=${encodeURIComponent(`/marketplace/${params.id}`)}`);
      return;
    }

    setOfferLoading(true);
    setError('');
    try {
      const offerPayload: { listingId: string; notes?: string } = { listingId: params.id };
      if (notes) offerPayload.notes = notes;
      await marketplace.makeOffer(offerPayload, token);
      track('make-offer', {
        listingCategory: listing?.passport?.categoryL1 ?? 'unknown',
        hasCustomNote: notes.trim().length > 0,
        priceBand: priceBand(listing?.pricePence ?? 0),
      });
      setSuccess('Offer placed. Track it in your Orders — the seller will see it there too.');
      toast({ title: 'Offer placed', description: 'Track it in your Orders.', variant: 'success' });
    } catch (e) {
      setError(getErrorMessage(e, 'place this offer'));
    } finally {
      setOfferLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading…</p>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Listing not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 flex items-center justify-between h-14">
          <Link
            href="/marketplace"
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            ← Marketplace
          </Link>
          <Link href="/" className="flex items-center" aria-label="TRACE home">
            <Logo className="h-6" />
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main info */}
          <div className="md:col-span-2 space-y-4">
            <div>
              <h1 className="text-2xl font-bold">{listing.passport.productName}</h1>
              <p className="text-gray-500">
                {categoryLabel(listing.passport.categoryL1, listing.passport.categoryL2)}
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {listing.passport.conditionGrade && (
                <Badge className="text-base px-3 py-1">
                  Grade {listing.passport.conditionGrade}
                </Badge>
              )}
              <Badge variant="outline">{listing.status}</Badge>
            </div>

            {listing.passport.conditionNotes && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm font-medium mb-1">Condition notes</p>
                  <p className="text-sm text-gray-600">{listing.passport.conditionNotes}</p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-4 space-y-2">
                <p className="text-sm font-medium">Material details</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-gray-500">Category</dt>
                  <dd>{categoryLabel(listing.passport.categoryL1)}</dd>
                  {listing.passport.categoryL2 && (
                    <>
                      <dt className="text-gray-500">Subcategory</dt>
                      <dd>
                        {subcategoryLabel(listing.passport.categoryL1, listing.passport.categoryL2)}
                      </dd>
                    </>
                  )}
                  {listing.passport.carbonSavingsVsNew && (
                    <>
                      <dt className="text-gray-500">Carbon savings</dt>
                      <dd className="text-green-600">
                        {listing.passport.carbonSavingsVsNew} kgCO₂e
                        {listing.passport.unitOfMeasure
                          ? ` per ${unitLabel(listing.passport.unitOfMeasure)}`
                          : ''}
                      </dd>
                    </>
                  )}
                  <dt className="text-gray-500">Quantity</dt>
                  <dd>
                    {listing.quantity}
                    {listing.passport.unitOfMeasure
                      ? ` ${unitLabel(listing.passport.unitOfMeasure)}`
                      : ''}
                  </dd>
                  <dt className="text-gray-500">Currency</dt>
                  <dd>{listing.currency}</dd>
                  <dt className="text-gray-500">Supplier hub</dt>
                  <dd>{listing.organisation.name}</dd>
                </dl>
              </CardContent>
            </Card>

            {/* Passport link */}
            <Link
              href={`/passport/${listing.passportId}`}
              className="text-sm text-brand-600 hover:underline"
            >
              View full material passport →
            </Link>
          </div>

          {/* Purchase panel */}
          <div className="space-y-4">
            <Card className="trace-showcase-only">
              <CardContent className="p-5 space-y-3">
                <p className="text-3xl font-bold text-brand-700">
                  {formatPrice(listing.pricePence)}
                </p>
                <p className="text-sm text-gray-600">
                  This public research showcase is read-only. Transactions and offers are disabled.
                </p>
              </CardContent>
            </Card>
            <Card className="trace-self-hosted-only">
              <CardContent className="p-5 space-y-4">
                <div>
                  <p className="text-3xl font-bold text-brand-700">
                    {formatPrice(listing.pricePence)}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    GBP · price includes VAT if applicable
                  </p>
                </div>

                {listing.status === 'active' ? (
                  !user ? (
                    /* Logged-out visitors get a sign-up CTA, never a buy button. */
                    <div className="space-y-3">
                      <Link
                        href={`/register?next=${encodeURIComponent(`/marketplace/${params.id}`)}`}
                        className="block"
                      >
                        <Button className="w-full bg-brand-600 hover:bg-brand-700">
                          Sign up to buy this material
                        </Button>
                      </Link>
                      <p className="text-xs text-gray-500 text-center">
                        Already have an account?{' '}
                        <Link
                          href={`/login?next=${encodeURIComponent(`/marketplace/${params.id}`)}`}
                          className="text-brand-600 hover:underline"
                        >
                          Sign in
                        </Link>
                      </p>
                    </div>
                  ) : success ? (
                    <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-3 space-y-2">
                      <p>{success}</p>
                      <Link href="/transactions" className="font-medium hover:underline">
                        View orders
                      </Link>
                    </div>
                  ) : (
                    <>
                      <textarea
                        placeholder="Add a note to the seller (optional)"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                      />
                      {error && <p className="text-xs text-red-600">{error}</p>}
                      <Button
                        className="w-full bg-brand-600 hover:bg-brand-700"
                        onClick={handleMakeOffer}
                        disabled={offerLoading}
                      >
                        {offerLoading ? 'Placing offer…' : 'Make offer at asking price'}
                      </Button>
                      <p className="text-xs text-gray-400 text-center">
                        You will receive confirmation from the seller.
                      </p>
                    </>
                  )
                ) : (
                  <p className="text-sm text-gray-500 text-center">
                    This listing is {listing.status}.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Shipping options */}
            {listing.shippingOptions.length > 0 && (
              <Card>
                <CardContent className="p-4 space-y-2">
                  <p className="text-sm font-medium">Shipping / collection</p>
                  {listing.shippingOptions.map((opt, i) => (
                    <div key={i} className="text-sm text-gray-600">
                      <span className="capitalize font-medium">{opt.method}</span>
                      {opt.deliveryCostPence !== undefined && (
                        <span>
                          {' '}
                          ·{' '}
                          {opt.deliveryCostPence === 0
                            ? 'Free'
                            : formatPrice(opt.deliveryCostPence)}
                        </span>
                      )}
                      {opt.deliveryRadiusMiles && (
                        <span> within {opt.deliveryRadiusMiles} miles</span>
                      )}
                      {opt.notes && <span> — {opt.notes}</span>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
