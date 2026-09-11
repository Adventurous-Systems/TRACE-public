'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { marketplace, passports, type PassportSummary } from '@/lib/api-client';
import { getToken } from '@/lib/auth';
import { track } from '@/lib/analytics';
import { toast } from '@/components/ui/use-toast';
import { celebrate } from '@/lib/confetti';
import { getErrorMessage } from '@/lib/api-errors';
import { categoryLabel } from '@/lib/categories';

export default function NewListingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [availablePassports, setAvailablePassports] = useState<PassportSummary[]>([]);
  const [passportId, setPassportId] = useState(searchParams.get('passportId') ?? '');
  const [pricePounds, setPricePounds] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [shippingMethod, setShippingMethod] = useState<'collection' | 'delivery' | 'both'>(
    'collection',
  );
  const [deliveryCostPounds, setDeliveryCostPounds] = useState('');
  const [deliveryRadiusMiles, setDeliveryRadiusMiles] = useState('');
  const [shippingNotes, setShippingNotes] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const params = new URLSearchParams({ status: 'active', limit: '100' });
    // Only materials with at least one photo can be listed (enforced server-side too).
    passports
      .list(params, token)
      .then((res) =>
        setAvailablePassports(res.data.filter((p) => (p.conditionPhotos?.length ?? 0) > 0)),
      )
      .catch(console.error);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) return;

    if (!passportId) {
      setError('Select a passport');
      return;
    }
    if (!pricePounds || isNaN(parseFloat(pricePounds)) || parseFloat(pricePounds) <= 0) {
      setError('Enter a valid price');
      return;
    }

    const pricePence = Math.round(parseFloat(pricePounds) * 100);
    const shippingOption: Record<string, unknown> = { method: shippingMethod };
    if (shippingNotes) shippingOption['notes'] = shippingNotes;
    if (shippingMethod === 'delivery' || shippingMethod === 'both') {
      if (deliveryCostPounds) {
        shippingOption['deliveryCostPence'] = Math.round(parseFloat(deliveryCostPounds) * 100);
      }
      if (deliveryRadiusMiles) {
        shippingOption['deliveryRadiusMiles'] = parseInt(deliveryRadiusMiles, 10);
      }
    }

    const payload = {
      passportId,
      pricePence,
      currency: 'GBP',
      quantity: parseInt(quantity, 10) || 1,
      shippingOptions: [shippingOption],
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    };

    setLoading(true);
    setError('');
    try {
      await marketplace.createListing(payload, token);
      track('listing-create', {
        materialCategory:
          availablePassports.find((p) => p.id === passportId)?.categoryL1 ?? 'unknown',
        quantity: payload.quantity,
        shippingMethod,
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
                {availablePassports.length === 0 && (
                  <p className="text-xs text-gray-400">
                    No active materials with a photo yet. At least one material photo is required
                    before listing — add one on the material&apos;s passport page, or{' '}
                    <a href="/passports/new" className="text-brand-600 hover:underline">
                      register a material first.
                    </a>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 space-y-4">
              <h2 className="font-semibold text-sm text-gray-700">Pricing</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="price">Price (£) *</Label>
                  <Input
                    id="price"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={pricePounds}
                    onChange={(e) => setPricePounds(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="expires">Listing expires (optional)</Label>
                <Input
                  id="expires"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
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
                        checked={shippingMethod === m}
                        onChange={() => setShippingMethod(m)}
                      />
                      <span className="capitalize">{m}</span>
                    </label>
                  ))}
                </div>
              </div>

              {(shippingMethod === 'delivery' || shippingMethod === 'both') && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="deliveryCost">Delivery cost (£)</Label>
                    <Input
                      id="deliveryCost"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00 = free"
                      value={deliveryCostPounds}
                      onChange={(e) => setDeliveryCostPounds(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="radius">Delivery radius (miles)</Label>
                    <Input
                      id="radius"
                      type="number"
                      min="1"
                      placeholder="e.g. 50"
                      value={deliveryRadiusMiles}
                      onChange={(e) => setDeliveryRadiusMiles(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="shippingNotes">Notes (optional)</Label>
                <Input
                  id="shippingNotes"
                  placeholder="e.g. forklift required for collection"
                  value={shippingNotes}
                  onChange={(e) => setShippingNotes(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

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
