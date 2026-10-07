'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { marketplace, passports, type PassportSummary } from '@/lib/api-client';
import { canCreateListing, getToken, getUser, type StoredUser } from '@/lib/auth';
import { NoAccess } from '@/components/ui/load-state';
import { track } from '@/lib/analytics';
import { toast } from '@/components/ui/use-toast';
import { celebrate } from '@/lib/confetti';
import { getErrorMessage } from '@/lib/api-errors';
import { categoryLabel } from '@/lib/categories';
import {
  EMPTY_TERMS,
  ListingTermsFields,
  expiryOf,
  pricePence,
  shippingOptionOf,
  termsError,
  type ListingTerms,
} from '@/components/marketplace/ListingTermsFields';

export default function NewListingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [availablePassports, setAvailablePassports] = useState<PassportSummary[]>([]);
  // Active materials that only lack a photo, so the page can say which (O1).
  const [needPhoto, setNeedPhoto] = useState<PassportSummary[]>([]);
  const [passportsLoaded, setPassportsLoaded] = useState(false);
  const [passportId, setPassportId] = useState(searchParams.get('passportId') ?? '');
  const [terms, setTerms] = useState<ListingTerms>(EMPTY_TERMS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [user, setUser] = useState<StoredUser | null>(null);

  useEffect(() => {
    const token = getToken();
    const currentUser = getUser();
    setUser(currentUser);
    if (!token || !canCreateListing(currentUser)) return;
    const params = new URLSearchParams({ status: 'active', limit: '100' });
    // Only materials with at least one photo can be listed (enforced server-side too).
    passports
      .list(params, token)
      .then((res) => {
        const hasPhoto = (p: PassportSummary) => (p.conditionPhotos?.length ?? 0) > 0;
        setAvailablePassports(res.data.filter(hasPhoto));
        setNeedPhoto(res.data.filter((p) => !hasPhoto(p)));
      })
      .catch(console.error)
      .finally(() => setPassportsLoaded(true));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) return;

    if (!passportId) {
      setError('Select a passport');
      return;
    }
    const invalid = termsError(terms);
    if (invalid) {
      setError(invalid);
      return;
    }

    const payload = {
      passportId,
      pricePence: pricePence(terms),
      currency: 'GBP',
      quantity: parseInt(terms.quantity, 10) || 1,
      minOrderQuantity: parseInt(terms.minOrderQuantity, 10) || 1,
      shippingOptions: [shippingOptionOf(terms)],
      expiresAt: expiryOf(terms) ?? undefined,
    };

    setLoading(true);
    setError('');
    try {
      await marketplace.createListing(payload, token);
      track('listing-create', {
        materialCategory:
          availablePassports.find((p) => p.id === passportId)?.categoryL1 ?? 'unknown',
        quantity: payload.quantity,
        shippingMethod: terms.shippingMethod,
      });
      toast({
        title: 'Listed on the marketplace',
        description: 'Your material is now visible to buyers.',
        variant: 'success',
      });
      void celebrate();
      router.push('/listings');
    } catch (e) {
      setError(getErrorMessage(e, 'create this listing'));
    } finally {
      setLoading(false);
    }
  }

  if (user && !canCreateListing(user)) {
    return (
      <DashboardLayout>
        <div className="max-w-xl space-y-6">
          <h1 className="text-2xl font-bold">New Listing</h1>
          <NoAccess message="Listing a material is for suppliers and hub staff with an organisation." />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-xl space-y-6">
        <h1 className="text-2xl font-bold">New Listing</h1>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Card>
            <CardContent className="p-5 space-y-4">
              <h2 className="font-semibold text-sm text-gray-700">Material</h2>

              <div className="space-y-1.5">
                <Label htmlFor="passport">Passport *</Label>
                <select
                  id="passport"
                  value={passportId}
                  onChange={(e) => setPassportId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  required
                >
                  <option value="">Select an active material…</option>
                  {availablePassports.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.productName} · {categoryLabel(p.categoryL1)}
                      {p.conditionGrade ? ` · Grade ${p.conditionGrade}` : ''}
                    </option>
                  ))}
                </select>
                {/* O1: this used to be one line of light-grey text, easy to miss. */}
                {passportsLoaded && (availablePassports.length === 0 || needPhoto.length > 0) && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
                    <p className="font-medium">
                      {availablePassports.length === 0
                        ? 'No material can be listed yet.'
                        : 'Some materials are missing from this list.'}{' '}
                      A material needs at least one photo before it can go on the marketplace.
                    </p>
                    {needPhoto.length > 0 ? (
                      <ul className="space-y-1">
                        {needPhoto.map((p) => (
                          <li key={p.id}>
                            {p.productName}:{' '}
                            <Link
                              href={`/passports/${p.id}#photos`}
                              className="font-medium text-brand-700 underline"
                            >
                              add a photo to list it
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        <Link
                          href="/passports/new"
                          className="font-medium text-brand-700 underline"
                        >
                          Register a material
                        </Link>{' '}
                        and add a photo to it.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <ListingTermsFields
            terms={terms}
            onChange={setTerms}
            unit={availablePassports.find((p) => p.id === passportId)?.unitOfMeasure}
          />

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <Button type="submit" className="bg-brand-600 hover:bg-brand-700" disabled={loading}>
              {loading ? 'Creating listing…' : 'Create listing'}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
