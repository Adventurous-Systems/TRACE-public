'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import {
  MATERIAL_CATEGORIES,
  CONDITION_GRADES,
  DECONSTRUCTION_METHODS,
  UNITS_OF_MEASURE,
  UNIT_OF_MEASURE_LABELS,
} from '@trace/core';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { passports } from '@/lib/api-client';
import { getToken, isHubStaff, isSupplier, getUser } from '@/lib/auth';
import { toast } from '@/components/ui/use-toast';
import { getErrorMessage } from '@/lib/api-errors';

const EDITABLE_STATUSES = ['draft', 'active'];

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface EditForm {
  productName: string;
  categoryL1: string;
  categoryL2: string;
  unitOfMeasure: string;
  manufacturerName: string;
  countryOfOrigin: string;
  conditionGrade: string;
  conditionNotes: string;
  deconstructionMethod: string;
  reclaimedBy: string;
  remainingLifeEstimate: string;
  handlingRequirements: string;
  gwpTotal: string;
  embodiedCarbon: string;
  recycledContent: string;
  carbonSavingsVsNew: string;
  dimensionLength: string;
  dimensionWidth: string;
  dimensionHeight: string;
  dimensionWeight: string;
  dimensionUnit: string;
}

function num(v: string): number | undefined {
  if (v === '' || v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function EditPassportPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { isSubmitting },
  } = useForm<EditForm>();
  const selectedL1 = watch('categoryL1');
  const l2Options = MATERIAL_CATEGORIES.find((c) => c.slug === selectedL1)?.subcategories ?? [];

  useEffect(() => {
    const token = getToken();
    const user = getUser();
    if (!token) {
      router.push('/login');
      return;
    }
    if (!(isHubStaff(user) || isSupplier(user))) {
      router.push(`/passports/${id}`);
      return;
    }

    passports
      .get(id, token)
      .then((p) => {
        if (!EDITABLE_STATUSES.includes(p.status)) {
          setError(
            `This material is ${p.status} and can no longer be edited. Editing is locked once a material is listed or sold.`,
          );
          return;
        }
        reset({
          productName: p.productName ?? '',
          categoryL1: p.categoryL1 ?? '',
          categoryL2: p.categoryL2 ?? '',
          unitOfMeasure: p.unitOfMeasure ?? '',
          manufacturerName: p.manufacturerName ?? '',
          countryOfOrigin: p.countryOfOrigin ?? '',
          conditionGrade: p.conditionGrade ?? '',
          conditionNotes: p.conditionNotes ?? '',
          deconstructionMethod: p.deconstructionMethod ?? '',
          reclaimedBy: p.reclaimedBy ?? '',
          remainingLifeEstimate:
            p.remainingLifeEstimate != null ? String(p.remainingLifeEstimate) : '',
          handlingRequirements: p.handlingRequirements ?? '',
          gwpTotal: p.gwpTotal ?? '',
          embodiedCarbon: p.embodiedCarbon ?? '',
          recycledContent: p.recycledContent ?? '',
          carbonSavingsVsNew: p.carbonSavingsVsNew ?? '',
          dimensionLength: p.dimensions?.length != null ? String(p.dimensions.length) : '',
          dimensionWidth: p.dimensions?.width != null ? String(p.dimensions.width) : '',
          dimensionHeight: p.dimensions?.height != null ? String(p.dimensions.height) : '',
          dimensionWeight: p.dimensions?.weight != null ? String(p.dimensions.weight) : '',
          dimensionUnit: p.dimensions?.unit ?? 'mm',
        });
      })
      .catch((e: unknown) => setError(getErrorMessage(e, 'load this material')))
      .finally(() => setLoading(false));
  }, [id, router, reset]);

  async function onSubmit(data: EditForm) {
    const token = getToken();
    if (!token) {
      router.push('/login');
      return;
    }
    const hasDims =
      data.dimensionLength || data.dimensionWidth || data.dimensionHeight || data.dimensionWeight;
    const payload = {
      productName: data.productName,
      categoryL1: data.categoryL1,
      categoryL2: data.categoryL2 || undefined,
      unitOfMeasure: data.unitOfMeasure || undefined,
      manufacturerName: data.manufacturerName || undefined,
      countryOfOrigin: data.countryOfOrigin || undefined,
      conditionGrade: data.conditionGrade || undefined,
      conditionNotes: data.conditionNotes || undefined,
      deconstructionMethod: data.deconstructionMethod || undefined,
      reclaimedBy: data.reclaimedBy || undefined,
      remainingLifeEstimate: num(data.remainingLifeEstimate),
      handlingRequirements: data.handlingRequirements || undefined,
      gwpTotal: num(data.gwpTotal),
      embodiedCarbon: num(data.embodiedCarbon),
      recycledContent: num(data.recycledContent),
      carbonSavingsVsNew: num(data.carbonSavingsVsNew),
      dimensions: hasDims
        ? {
            length: num(data.dimensionLength),
            width: num(data.dimensionWidth),
            height: num(data.dimensionHeight),
            weight: num(data.dimensionWeight),
            unit: data.dimensionUnit || 'mm',
          }
        : undefined,
    };
    try {
      await passports.update(id, payload, token);
      toast({
        title: 'Material updated',
        description: 'Your changes are saved and the integrity fingerprint was regenerated.',
        variant: 'success',
      });
      router.push(`/passports/${id}`);
    } catch (e) {
      toast({
        title: 'Could not save changes',
        description: getErrorMessage(e, 'save these changes'),
        variant: 'destructive',
      });
    }
  }

  if (loading)
    return (
      <DashboardLayout>
        <p className="text-sm text-gray-500">Loading…</p>
      </DashboardLayout>
    );

  if (error) {
    return (
      <DashboardLayout>
        <div className="max-w-xl space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Editing unavailable</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">{error}</p>
              <Link href={`/passports/${id}`} className="mt-4 inline-block">
                <Button variant="outline">Back to material</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Edit material</h1>
          <p className="text-sm text-gray-500">
            Editing is an append-only amendment — saving regenerates the tamper-evident fingerprint
            and is recorded in the material&apos;s history.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Product</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="productName">Product name</Label>
                <Input id="productName" {...register('productName', { required: true })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="categoryL1">Category</Label>
                  <select
                    id="categoryL1"
                    className={selectClass}
                    {...register('categoryL1', { required: true })}
                  >
                    {MATERIAL_CATEGORIES.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="categoryL2">Subcategory</Label>
                  <select id="categoryL2" className={selectClass} {...register('categoryL2')}>
                    <option value="">—</option>
                    {l2Options.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="unitOfMeasure">Sold / measured per</Label>
                <select id="unitOfMeasure" className={selectClass} {...register('unitOfMeasure')}>
                  <option value="">— select —</option>
                  {UNITS_OF_MEASURE.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_OF_MEASURE_LABELS[u]}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">
                  Basis for quantity, price, and carbon — e.g. per block (each), per m², per kg.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="manufacturerName">Manufacturer / source</Label>
                  <Input id="manufacturerName" {...register('manufacturerName')} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="countryOfOrigin">Country of origin (ISO code)</Label>
                  <Input
                    id="countryOfOrigin"
                    maxLength={2}
                    placeholder="GB"
                    {...register('countryOfOrigin')}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Condition & dimensions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="conditionGrade">Condition grade</Label>
                  <select
                    id="conditionGrade"
                    className={selectClass}
                    {...register('conditionGrade')}
                  >
                    <option value="">—</option>
                    {CONDITION_GRADES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="deconstructionMethod">Deconstruction method</Label>
                  <select
                    id="deconstructionMethod"
                    className={selectClass}
                    {...register('deconstructionMethod')}
                  >
                    <option value="">—</option>
                    {DECONSTRUCTION_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="conditionNotes">Condition notes</Label>
                <textarea
                  id="conditionNotes"
                  rows={3}
                  className={selectClass + ' h-auto'}
                  {...register('conditionNotes')}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="reclaimedBy">Reclaimed by</Label>
                  <Input id="reclaimedBy" {...register('reclaimedBy')} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="remainingLifeEstimate">Remaining life (years)</Label>
                  <Input
                    id="remainingLifeEstimate"
                    type="number"
                    {...register('remainingLifeEstimate')}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="handlingRequirements">Handling requirements</Label>
                <Input id="handlingRequirements" {...register('handlingRequirements')} />
              </div>
              <div className="grid grid-cols-5 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500">Length</Label>
                  <Input type="number" step="any" {...register('dimensionLength')} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500">Width</Label>
                  <Input type="number" step="any" {...register('dimensionWidth')} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500">Height</Label>
                  <Input type="number" step="any" {...register('dimensionHeight')} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500">Weight (kg)</Label>
                  <Input type="number" step="any" {...register('dimensionWeight')} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500">Unit</Label>
                  <select className={selectClass} {...register('dimensionUnit')}>
                    <option value="mm">mm</option>
                    <option value="cm">cm</option>
                    <option value="m">m</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Environmental</CardTitle>
              <CardDescription>Figures are per the unit of measure selected above.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="carbonSavingsVsNew">Carbon savings vs new (kgCO₂e per unit)</Label>
                <Input
                  id="carbonSavingsVsNew"
                  type="number"
                  step="any"
                  {...register('carbonSavingsVsNew')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="embodiedCarbon">Embodied carbon (kgCO₂e per unit)</Label>
                <Input
                  id="embodiedCarbon"
                  type="number"
                  step="any"
                  {...register('embodiedCarbon')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gwpTotal">GWP total (kgCO₂e per unit)</Label>
                <Input id="gwpTotal" type="number" step="any" {...register('gwpTotal')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="recycledContent">Recycled content (%)</Label>
                <Input
                  id="recycledContent"
                  type="number"
                  step="any"
                  {...register('recycledContent')}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </Button>
            <Link href={`/passports/${id}`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
