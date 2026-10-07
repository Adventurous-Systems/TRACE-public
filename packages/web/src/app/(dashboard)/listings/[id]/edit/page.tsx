'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { formatQuantity } from '@trace/core';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadFailure, NoAccess } from '@/components/ui/load-state';
import { toast } from '@/components/ui/use-toast';
import { ApiError, marketplace, type ListingSummary } from '@/lib/api-client';
import { canCreateListing, getToken, getUser, type StoredUser } from '@/lib/auth';
import { getErrorMessage } from '@/lib/api-errors';
import { categoryLabel } from '@/lib/categories';
import { listingStatus } from '@/lib/orders';
import {
  ListingTermsFields,
  changedTerms,
  termsError,
  termsFromListing,
  ukDay,
  type ListingTerms,
} from '@/components/marketplace/ListingTermsFields';

/** Lots a seller can still change (D1, D3); a sold or cancelled one stays closed (D2). */
const EDITABLE = ['active', 'reserved', 'expired'];

/** How much of the lot orders hold: open or completed, so the quantity can't go below it. */
const committedOf = (l: ListingSummary) => l.quantity - l.quantityAvailable;

/** Would these terms leave the lot past its date? */
function stillExpired(terms: ListingTerms): boolean {
  return terms.expiresAt !== '' && terms.expiresAt < ukDay(new Date());
}

export default function EditListingPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [listing, setListing] = useState<ListingSummary | null>(null);
  // The terms as loaded, so only what the seller changes is sent.
  const [initial, setInitial] = useState<ListingTerms | null>(null);
  const [terms, setTerms] = useState<ListingTerms | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setUser(getUser());
  }, []);

  function load() {
    setLoadError('');
    marketplace
      .getListing(params.id)
      .then((l) => {
        setListing(l);
        const loaded = termsFromListing(l);
        setInitial(loaded);
        setTerms(loaded);
      })
      .catch((e) => setLoadError(getErrorMessage(e, 'this listing')));
  }

  useEffect(() => {
    if (user && canCreateListing(user)) load();
  }, [user, params.id]);

  /** After a refusal: reload the lot and say, in our words, what stands in the way. */
  async function explainRefusal(e: unknown, tried: ListingTerms) {
    if (e instanceof ApiError && e.code === 'MATERIAL_RELISTED') {
      setError(
        'This material has been listed again since this listing expired. Edit that listing on your Listings page instead.',
      );
      return;
    }
    const fresh =
      e instanceof ApiError && (e.status === 409 || e.status === 400)
        ? await marketplace.getListing(params.id).catch(() => null)
        : null;
    if (!fresh) {
      setError(getErrorMessage(e, 'save these changes'));
      return;
    }
    // Keep what the seller typed; compare against the lot as it is now.
    setListing(fresh);
    setInitial(termsFromListing(fresh));
    const now = listingStatus(fresh);
    const committed = committedOf(fresh);
    const unit = fresh.passport.unitOfMeasure;
    if (!EDITABLE.includes(now)) {
      setError(`This lot is now ${now} and can no longer be changed.`);
    } else if ((parseInt(tried.quantity, 10) || 1) < committed) {
      setError(
        `An order arrived while you were editing: orders now hold ${formatQuantity(committed, unit)}, so the quantity can't go below that.`,
      );
    } else {
      setError('This lot changed while you were editing it. Check the figures and save again.');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token || !listing || !initial || !terms) return;

    const quantity = parseInt(terms.quantity, 10) || 1;
    const minimum = parseInt(terms.minOrderQuantity, 10) || 1;
    const committed = committedOf(listing);
    const unit = listing.passport.unitOfMeasure;
    const problem =
      termsError(terms) ??
      (quantity < committed
        ? `Orders hold ${formatQuantity(committed, unit)}, so the quantity can't go below that.`
        : minimum > quantity
          ? "The minimum order can't be more than the quantity in the lot."
          : listingStatus(listing) === 'expired' &&
              (terms.expiresAt === initial.expiresAt || stillExpired(terms))
            ? 'This listing has expired. Choose a new date, or clear the date, to put it back on sale.'
            : null);
    if (problem) {
      setError(problem);
      return;
    }
    const body = changedTerms(initial, terms);
    if (Object.keys(body).length === 0) {
      setError('Nothing has changed yet.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const saved = await marketplace.updateListing(listing.id, body, token);
      const back = listingStatus(listing) !== 'active' && listingStatus(saved) === 'active';
      toast({
        title: back ? 'Back on the marketplace' : 'Listing updated',
        description: back
          ? 'Buyers can order from this lot again.'
          : 'Buyers see the new terms straight away.',
        variant: 'success',
      });
      router.push('/listings');
    } catch (err) {
      await explainRefusal(err, terms);
    } finally {
      setSaving(false);
    }
  }

  if (user && !canCreateListing(user)) {
    return (
      <DashboardLayout>
        <div className="max-w-xl space-y-6">
          <h1 className="text-2xl font-bold">Edit listing</h1>
          <NoAccess message="Listings are managed by suppliers and hub staff." />
        </div>
      </DashboardLayout>
    );
  }

  const status = listing ? listingStatus(listing) : null;
  const theirs = listing && user && listing.organisationId !== user.organisationId;
  const committed = listing ? committedOf(listing) : 0;
  const unit = listing?.passport.unitOfMeasure;

  return (
    <DashboardLayout>
      <div className="max-w-xl space-y-6">
        <div className="space-y-1">
          <Link href="/listings" className="text-sm text-brand-600 hover:underline">
            ← Listings
          </Link>
          <h1 className="text-2xl font-bold">Edit listing</h1>
        </div>

        {loadError ? (
          <LoadFailure message={loadError} onRetry={load} />
        ) : !listing || !terms ? (
          <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
        ) : theirs ? (
          <NoAccess message="This listing belongs to another organisation." />
        ) : !EDITABLE.includes(status ?? '') ? (
          <Card>
            <CardContent className="p-5 space-y-2 text-sm">
              <p className="font-medium">{listing.passport.productName}</p>
              <p className="text-gray-600">
                This lot is {status} and can no longer be changed. To sell more of this material,
                create a new listing.
              </p>
            </CardContent>
          </Card>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <Card>
              <CardContent className="p-5 space-y-1">
                <p className="font-medium">{listing.passport.productName}</p>
                <p className="text-xs text-gray-500">
                  {categoryLabel(listing.passport.categoryL1, listing.passport.categoryL2)}
                  {listing.passport.conditionGrade
                    ? ` · Grade ${listing.passport.conditionGrade}`
                    : ''}
                </p>
                <p className="text-xs text-gray-700">
                  {formatQuantity(listing.quantityAvailable, unit)} of{' '}
                  {formatQuantity(listing.quantity, unit)} left
                  {committed > 0 ? ` · ${formatQuantity(committed, unit)} ordered or sold` : ''}
                </p>
                {status === 'reserved' && (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Every unit of this lot is ordered, so it is off the marketplace. Raise the
                    quantity to put more on sale.
                  </p>
                )}
                {status === 'expired' && (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    This listing has expired. Choose a new date, or clear the date, to put it back
                    on sale.
                  </p>
                )}
              </CardContent>
            </Card>

            <ListingTermsFields
              terms={terms}
              onChange={(next) => setTerms(next)}
              unit={unit}
              priceHint={committed > 0 ? 'Orders already placed keep their price.' : undefined}
              quantityHint={
                committed > 0
                  ? `Orders hold ${formatQuantity(committed, unit)}, so the quantity can't go below that.`
                  : undefined
              }
            />

            {error && (
              <p
                role="alert"
                className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2"
              >
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <Button type="submit" className="bg-brand-600 hover:bg-brand-700" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
              <Link href="/listings">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        )}
      </div>
    </DashboardLayout>
  );
}
