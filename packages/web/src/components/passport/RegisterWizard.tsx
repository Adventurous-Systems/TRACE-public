'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Fingerprint, AlertTriangle, Leaf, Camera, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  MATERIAL_CATEGORIES,
  CONDITION_GRADES,
  DECONSTRUCTION_METHODS,
  UNITS_OF_MEASURE,
  UNIT_OF_MEASURE_LABELS,
} from '@trace/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { passports, type PassportCertificate } from '@/lib/api-client';
import { CARBON_FACTOR_PER_KG, DEFAULT_CARBON_FACTOR } from '@/lib/carbon-factors';
import { subcategoryLabel, categoryLabel } from '@/lib/categories';
import { getToken, getUser, canRegisterMaterial, type StoredUser } from '@/lib/auth';
import { NoAccess } from '@/components/ui/load-state';
import { getErrorMessage } from '@/lib/api-errors';
import { track } from '@/lib/analytics';
import { celebrate } from '@/lib/confetti';
import { toast } from '@/components/ui/use-toast';

// ─── Wizard steps ────────────────────────────────────────────────────────────

const STEPS = [
  { id: 'basic', label: 'Basic info' },
  { id: 'specs', label: 'Material specs' },
  { id: 'circular', label: 'Circular data' },
  { id: 'environmental', label: 'Environmental' },
  { id: 'review', label: 'Review & submit' },
  { id: 'verification', label: 'Verification' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

// ─── Form schema ─────────────────────────────────────────────────────────────

const WizardSchema = z.object({
  // Step 1 — Basic
  productName: z.string().min(1, 'Product name is required').max(255),
  categoryL1: z.string().min(1, 'Category is required'),
  categoryL2: z.string().optional(),
  manufacturerName: z.string().optional(),
  countryOfOrigin: z.string().length(2).optional().or(z.literal('')),
  serialNumber: z.string().optional(),

  // Step 2 — Specs
  unitOfMeasure: z.enum(UNITS_OF_MEASURE).optional().or(z.literal('')),
  dimensionLength: z.coerce.number().positive().optional().or(z.literal('')),
  dimensionWidth: z.coerce.number().positive().optional().or(z.literal('')),
  dimensionHeight: z.coerce.number().positive().optional().or(z.literal('')),
  dimensionWeight: z.coerce.number().positive().optional().or(z.literal('')),
  dimensionUnit: z.enum(['mm', 'cm', 'm']).default('mm'),

  // Step 3 — Circular
  conditionGrade: z.enum(['A', 'B', 'C', 'D']).optional().or(z.literal('')),
  conditionNotes: z.string().max(2000).optional(),
  deconstructionMethod: z.string().optional(),
  reclaimedBy: z.string().optional(),
  previousBuildingId: z.string().optional(),
  remainingLifeEstimate: z.coerce.number().int().nonnegative().optional().or(z.literal('')),
  handlingRequirements: z.string().optional(),

  // Step 4 — Environmental
  gwpTotal: z.coerce.number().nonnegative().optional().or(z.literal('')),
  embodiedCarbon: z.coerce.number().nonnegative().optional().or(z.literal('')),
  recycledContent: z.coerce.number().min(0).max(100).optional().or(z.literal('')),
  carbonSavingsVsNew: z.coerce.number().nonnegative().optional().or(z.literal('')),
  epdReference: z.string().url().optional().or(z.literal('')),
  ceMarking: z.boolean().default(false),
});

type WizardForm = z.infer<typeof WizardSchema>;

const STORAGE_KEY = 'trace_register_wizard';

// ─── Component ────────────────────────────────────────────────────────────────

export default function RegisterWizard() {
  const router = useRouter();
  const [step, setStep] = useState<StepId>('basic');
  const [error, setError] = useState<string | null>(null);
  const [createdPassportId, setCreatedPassportId] = useState<string | null>(null);
  const [certificate, setCertificate] = useState<PassportCertificate | null>(null);
  const celebratedRef = useRef(false);
  const [minVerifyDelayPassed, setMinVerifyDelayPassed] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  // J-11: app/(dashboard)/passports/new/page.tsx is a server component and
  // role lives in localStorage, so it cannot be guarded server-side. This is
  // the guard for that route — checked here, not at the page, so it applies
  // regardless of how the route is reached. Effect-based to avoid a
  // hydration mismatch (getUser() returns null on the server); all hooks
  // above and below still run unconditionally on every render, so the
  // actual gate is only in the JSX returned at the bottom of this
  // component, never an early return.
  const [wizardUser, setWizardUser] = useState<StoredUser | null>(null);
  useEffect(() => {
    setWizardUser(getUser());
  }, []);

  function addPhotoFiles(files: FileList | null) {
    if (!files) return;
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (images.length) setPhotos((prev) => [...prev, ...images]);
  }

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<WizardForm>({
    // Resolver's inferred input type differs because the schema uses coercion.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(WizardSchema) as any,
    defaultValues: {
      dimensionUnit: 'mm',
      ceMarking: false,
    },
  });

  const selectedL1 = watch('categoryL1');

  // Live values powering the preview + the carbon suggestion.
  const formValues = watch();
  const previewCategory = MATERIAL_CATEGORIES.find((c) => c.slug === formValues.categoryL1)?.label;
  const weightNum = Number(formValues.dimensionWeight) || 0;
  const suggestedCarbon =
    weightNum > 0
      ? Math.round(
          weightNum *
            (CARBON_FACTOR_PER_KG[formValues.categoryL1 ?? ''] ?? DEFAULT_CARBON_FACTOR) *
            100,
        ) / 100
      : null;
  const l2Options = MATERIAL_CATEGORIES.find((c) => c.slug === selectedL1)?.subcategories ?? [];

  // Persist to localStorage on change
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<WizardForm>;
        Object.entries(parsed).forEach(([k, v]) => {
          setValue(k as keyof WizardForm, v as never);
        });
      } catch {
        // ignore parse errors
      }
    }
  }, [setValue]);

  useEffect(() => {
    if (!createdPassportId || step !== 'verification') return;
    let cancelled = false;

    async function pollCertificate() {
      try {
        const next = await passports.certificate(createdPassportId!);
        if (!cancelled) {
          setCertificate(next);
          setVerificationError(null);
        }
        return next.status;
      } catch (err) {
        if (!cancelled) {
          setVerificationError(
            err instanceof Error ? err.message : 'Unable to load verification status',
          );
        }
        return 'pending';
      }
    }

    pollCertificate();
    const interval = window.setInterval(async () => {
      const status = await pollCertificate();
      // J-05: 'simulated' was missing here, so the poll never stopped in the
      // exact mode the demo runs in — measured 6 requests in 20s after the
      // certificate had already resolved. CertificatePanel.tsx's equivalent
      // condition already includes it; this brings the wizard in line.
      if (status === 'verified' || status === 'failed' || status === 'simulated') {
        window.clearInterval(interval);
      }
    }, 3500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [createdPassportId, step]);

  // Hold the "verifying" screen for a beat so it's visibly seen before the result.
  useEffect(() => {
    setMinVerifyDelayPassed(false);
    if (step !== 'verification') return;
    const t = setTimeout(() => setMinVerifyDelayPassed(true), 3500);
    return () => clearTimeout(t);
  }, [step]);

  const certResolved =
    certificate?.status === 'verified' ||
    certificate?.status === 'simulated' ||
    certificate?.status === 'failed';
  const displayStatus: PassportCertificate['status'] =
    minVerifyDelayPassed && certResolved ? certificate!.status : 'pending';

  // One-time celebration when the trust record visibly becomes ready.
  useEffect(() => {
    if (!celebratedRef.current && (displayStatus === 'verified' || displayStatus === 'simulated')) {
      celebratedRef.current = true;
      void celebrate();
    }
  }, [displayStatus]);

  const currentIndex = STEPS.findIndex((s) => s.id === step);

  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getValues()));
  }

  function goNext() {
    saveProgress();
    const next = STEPS[currentIndex + 1];
    if (next) setStep(next.id);
  }

  function goPrev() {
    const prev = STEPS[currentIndex - 1];
    if (prev) setStep(prev.id);
  }

  async function onSubmit(data: WizardForm) {
    setError(null);
    const token = getToken();
    if (!token) {
      router.push('/login');
      return;
    }

    try {
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
        previousBuildingId: data.previousBuildingId || undefined,
        remainingLifeEstimate: data.remainingLifeEstimate || undefined,
        handlingRequirements: data.handlingRequirements || undefined,
        gwpTotal: data.gwpTotal || undefined,
        embodiedCarbon: data.embodiedCarbon || undefined,
        recycledContent: data.recycledContent || undefined,
        carbonSavingsVsNew: data.carbonSavingsVsNew || undefined,
        epdReference: data.epdReference || undefined,
        ceMarking: data.ceMarking,
        dimensions:
          data.dimensionLength ||
          data.dimensionWidth ||
          data.dimensionHeight ||
          data.dimensionWeight
            ? {
                length: data.dimensionLength || undefined,
                width: data.dimensionWidth || undefined,
                height: data.dimensionHeight || undefined,
                weight: data.dimensionWeight || undefined,
                unit: data.dimensionUnit,
              }
            : undefined,
      };

      const passport = await passports.create(payload, token);
      track('passport-create', {
        materialCategory: data.categoryL1,
        hasPhotos: photos.length > 0,
        hasConditionGrade: Boolean(data.conditionGrade),
        certified: Boolean(data.ceMarking),
      });
      // Upload any photos staged in the wizard (non-blocking on individual failures).
      for (const file of photos) {
        try {
          await passports.uploadPhoto(passport.id, file, token);
        } catch {
          /* a failed photo shouldn't block the flow */
        }
      }
      localStorage.removeItem(STORAGE_KEY);
      setCreatedPassportId(passport.id);
      setCertificate(null);
      setStep('verification');
      toast({
        title: 'Material passport created',
        description: 'Preparing its tamper-evident trust record…',
        variant: 'success',
      });
    } catch (err) {
      setError(getErrorMessage(err, 'register this material'));
    }
  }

  const preview = (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">Live preview</p>
      <div className="rounded-lg border bg-gradient-to-b from-brand-50 to-white p-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-700">
            Material passport
          </span>
          <ShieldCheck className="h-4 w-4 text-gray-300" />
        </div>
        <p className="mt-2 text-sm font-semibold leading-tight">
          {formValues.productName || 'Your material'}
        </p>
        <p className="text-xs text-gray-500">
          {previewCategory || 'Category'}
          {formValues.categoryL2
            ? ` · ${subcategoryLabel(formValues.categoryL1, formValues.categoryL2)}`
            : ''}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {formValues.conditionGrade && (
            <Badge variant="success">Grade {formValues.conditionGrade}</Badge>
          )}
          {formValues.carbonSavingsVsNew ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              <Leaf className="h-3 w-3" /> {formValues.carbonSavingsVsNew} kgCO₂e
            </span>
          ) : null}
          {photos.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              <Camera className="h-3 w-3" /> {photos.length}
            </span>
          )}
        </div>
        <p className="mt-3 border-t pt-2 text-[10px] text-gray-400">
          Tamper-evident trust record prepared on submit
        </p>
      </div>
    </div>
  );

  if (wizardUser && !canRegisterMaterial(wizardUser)) {
    return (
      <NoAccess message="Registering a material is for suppliers and hub staff with an organisation." />
    );
  }

  return (
    <div className="mx-auto max-w-5xl lg:flex lg:items-start lg:gap-8">
      <form onSubmit={handleSubmit(onSubmit)} className="min-w-0 lg:flex-1">
        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2 flex-1">
              <div
                className={`w-7 h-7 rounded-full text-xs flex items-center justify-center font-medium shrink-0 ${
                  i < currentIndex
                    ? 'bg-brand-600 text-white'
                    : i === currentIndex
                      ? 'border-2 border-brand-600 text-brand-600'
                      : 'bg-gray-100 text-gray-400'
                }`}
              >
                {i < currentIndex ? '✓' : i + 1}
              </div>
              <span
                className={`text-xs hidden sm:block ${
                  i === currentIndex ? 'text-brand-600 font-medium' : 'text-gray-400'
                }`}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <div
                  className={`h-0.5 flex-1 ${i < currentIndex ? 'bg-brand-600' : 'bg-gray-200'}`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Basic info */}
        {step === 'basic' && (
          <Card>
            <CardHeader>
              <CardTitle>Basic information</CardTitle>
              <CardDescription>Core identity of the material</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="productName">Product name *</Label>
                <Input
                  id="productName"
                  placeholder="e.g. 150mm RSJ Steel Beam"
                  {...register('productName')}
                />
                {errors.productName && (
                  <p className="text-sm text-red-500">{errors.productName.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="categoryL1">Category *</Label>
                <select
                  id="categoryL1"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...register('categoryL1')}
                >
                  <option value="">Select a category</option>
                  {MATERIAL_CATEGORIES.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {errors.categoryL1 && (
                  <p className="text-sm text-red-500">{errors.categoryL1.message}</p>
                )}
              </div>

              {l2Options.length > 0 && (
                <div className="space-y-1">
                  <Label htmlFor="categoryL2">Subcategory</Label>
                  <select
                    id="categoryL2"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    {...register('categoryL2')}
                  >
                    <option value="">Select subcategory</option>
                    {l2Options.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="manufacturerName">Manufacturer</Label>
                  <Input
                    id="manufacturerName"
                    placeholder="Manufacturer name"
                    {...register('manufacturerName')}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="countryOfOrigin">Country of origin (ISO)</Label>
                  <Input
                    id="countryOfOrigin"
                    placeholder="GB"
                    maxLength={2}
                    className="uppercase"
                    {...register('countryOfOrigin')}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="serialNumber">Serial number</Label>
                <Input
                  id="serialNumber"
                  placeholder="Optional serial / batch number"
                  {...register('serialNumber')}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Specs */}
        {step === 'specs' && (
          <Card>
            <CardHeader>
              <CardTitle>Material specifications</CardTitle>
              <CardDescription>Physical dimensions and technical data</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Dimensions</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="dimensionLength" className="text-xs text-gray-500">
                      Length
                    </Label>
                    <Input
                      id="dimensionLength"
                      type="number"
                      placeholder="0"
                      step="any"
                      {...register('dimensionLength')}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dimensionWidth" className="text-xs text-gray-500">
                      Width
                    </Label>
                    <Input
                      id="dimensionWidth"
                      type="number"
                      placeholder="0"
                      step="any"
                      {...register('dimensionWidth')}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dimensionHeight" className="text-xs text-gray-500">
                      Height / Depth
                    </Label>
                    <Input
                      id="dimensionHeight"
                      type="number"
                      placeholder="0"
                      step="any"
                      {...register('dimensionHeight')}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dimensionWeight" className="text-xs text-gray-500">
                      Weight (kg)
                    </Label>
                    <Input
                      id="dimensionWeight"
                      type="number"
                      placeholder="0"
                      step="any"
                      {...register('dimensionWeight')}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="dimensionUnit">Dimension unit</Label>
                <select
                  id="dimensionUnit"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...register('dimensionUnit')}
                >
                  <option value="mm">mm</option>
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="unitOfMeasure">Sold / measured per</Label>
                <select
                  id="unitOfMeasure"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...register('unitOfMeasure')}
                >
                  <option value="">— select —</option>
                  {UNITS_OF_MEASURE.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_OF_MEASURE_LABELS[u]}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">
                  The basis for quantity, price, and carbon — e.g. per block (each), per m², per kg.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Circular data */}
        {step === 'circular' && (
          <Card>
            <CardHeader>
              <CardTitle>Circular economy data</CardTitle>
              <CardDescription>Condition, origin, and reuse information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="conditionGrade">Condition grade</Label>
                <select
                  id="conditionGrade"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...register('conditionGrade')}
                >
                  <option value="">Select grade</option>
                  {CONDITION_GRADES.map((g) => (
                    <option key={g} value={g}>
                      Grade {g}
                      {g === 'A'
                        ? ' — Excellent'
                        : g === 'B'
                          ? ' — Good'
                          : g === 'C'
                            ? ' — Fair'
                            : ' — Poor'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="conditionNotes">Condition notes</Label>
                <textarea
                  id="conditionNotes"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Describe the current condition in detail..."
                  {...register('conditionNotes')}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="deconstructionMethod">Deconstruction method</Label>
                  <select
                    id="deconstructionMethod"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    {...register('deconstructionMethod')}
                  >
                    <option value="">Select method</option>
                    {DECONSTRUCTION_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="remainingLifeEstimate">Remaining life (years)</Label>
                  <Input
                    id="remainingLifeEstimate"
                    type="number"
                    placeholder="e.g. 25"
                    {...register('remainingLifeEstimate')}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="previousBuildingId">Previous building ID</Label>
                  <Input
                    id="previousBuildingId"
                    placeholder="Optional building reference"
                    {...register('previousBuildingId')}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="reclaimedBy">Reclaimed by</Label>
                  <Input
                    id="reclaimedBy"
                    placeholder="Organisation / contractor"
                    {...register('reclaimedBy')}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="handlingRequirements">Handling requirements</Label>
                <Input
                  id="handlingRequirements"
                  placeholder="e.g. Crane required, fragile joints"
                  {...register('handlingRequirements')}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Environmental */}
        {step === 'environmental' && (
          <Card>
            <CardHeader>
              <CardTitle>Environmental data</CardTitle>
              <CardDescription>Carbon and environmental performance metrics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="gwpTotal">GWP total (kgCO₂e)</Label>
                  <Input
                    id="gwpTotal"
                    type="number"
                    step="any"
                    placeholder="0.00"
                    {...register('gwpTotal')}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="embodiedCarbon">Embodied carbon (kgCO₂e)</Label>
                  <Input
                    id="embodiedCarbon"
                    type="number"
                    step="any"
                    placeholder="0.00"
                    {...register('embodiedCarbon')}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="recycledContent">Recycled content (%)</Label>
                  <Input
                    id="recycledContent"
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    placeholder="0"
                    {...register('recycledContent')}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="carbonSavingsVsNew">
                    Carbon savings vs new (kgCO₂e per unit)
                  </Label>
                  <Input
                    id="carbonSavingsVsNew"
                    type="number"
                    step="any"
                    placeholder="0.00"
                    {...register('carbonSavingsVsNew')}
                  />
                  {suggestedCarbon != null && (
                    <button
                      type="button"
                      onClick={() => setValue('carbonSavingsVsNew', suggestedCarbon as never)}
                      className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
                    >
                      <Leaf className="h-3 w-3" /> Suggest ~{suggestedCarbon} kgCO₂e (from{' '}
                      {weightNum} kg)
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="epdReference">EPD reference URL</Label>
                <Input
                  id="epdReference"
                  type="url"
                  placeholder="https://..."
                  {...register('epdReference')}
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="ceMarking"
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-300 text-brand-600"
                  {...register('ceMarking')}
                />
                <Label htmlFor="ceMarking">CE marking</Label>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 5: Review */}
        {step === 'review' && (
          <Card>
            <CardHeader>
              <CardTitle>Review & submit</CardTitle>
              <CardDescription>
                Your passport will be created and queued for blockchain anchoring.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(() => {
                const vals = getValues();
                return (
                  <dl className="divide-y text-sm">
                    {[
                      ['Product name', vals.productName],
                      ['Category', categoryLabel(vals.categoryL1, vals.categoryL2)],
                      ['Condition grade', vals.conditionGrade || '—'],
                      ['Manufacturer', vals.manufacturerName || '—'],
                      ['Country', vals.countryOfOrigin || '—'],
                      ['GWP total', vals.gwpTotal ? `${vals.gwpTotal} kgCO₂e` : '—'],
                      [
                        'Carbon savings',
                        vals.carbonSavingsVsNew ? `${vals.carbonSavingsVsNew} kgCO₂e` : '—',
                      ],
                      ['Deconstruction', vals.deconstructionMethod || '—'],
                      [
                        'Remaining life',
                        vals.remainingLifeEstimate ? `${vals.remainingLifeEstimate} years` : '—',
                      ],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between py-2">
                        <dt className="text-gray-500">{label}</dt>
                        <dd className="font-medium">{value}</dd>
                      </div>
                    ))}
                  </dl>
                );
              })()}

              {/* Optional in-wizard photos (drag-drop / mobile camera) — uploaded on submit. */}
              <div className="space-y-2">
                <Label>Photos (optional)</Label>
                <div
                  onClick={() => photoInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    addPhotoFiles(e.dataTransfer.files);
                  }}
                  className="cursor-pointer rounded-lg border-2 border-dashed border-gray-200 p-4 text-center transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <Camera className="mx-auto h-6 w-6 text-gray-400" />
                  <p className="mt-1 text-xs text-gray-500">
                    Tap to take a photo or drop images here
                  </p>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      addPhotoFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </div>
                {photos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {photos.map((f, i) => (
                      <div key={i} className="relative">
                        <img
                          src={URL.createObjectURL(f)}
                          alt=""
                          className="h-14 w-14 rounded-md border object-cover"
                        />
                        <button
                          type="button"
                          aria-label="Remove photo"
                          onClick={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}
                          className="absolute -right-1.5 -top-1.5 rounded-full bg-white border p-0.5 text-gray-500 shadow-sm hover:text-gray-800"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-400">
                  A photo is required before listing — add one now or later.
                </p>
              </div>

              {error && (
                <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
              )}
            </CardContent>
          </Card>
        )}

        {step === 'verification' && (
          <Card>
            <CardHeader>
              <CardTitle>Verification</CardTitle>
              <CardDescription>
                {certificate?.status === 'simulated'
                  ? 'TRACE is preparing the passport’s tamper-evident trust record.'
                  : 'TRACE is registering the passport fingerprint on VeChainThor.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-col items-center text-center py-2">
                {displayStatus === 'verified' || displayStatus === 'simulated' ? (
                  <div className="relative">
                    <span className="absolute inset-0 rounded-full bg-green-400/40 motion-safe:animate-ring-pulse" />
                    <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-700 motion-safe:animate-seal-pop">
                      <ShieldCheck className="h-8 w-8" />
                    </div>
                  </div>
                ) : displayStatus === 'failed' ? (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600">
                    <AlertTriangle className="h-8 w-8" />
                  </div>
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100 text-yellow-600">
                    <Fingerprint className="h-8 w-8 animate-pulse" />
                  </div>
                )}
              </div>

              <div
                className={`rounded-md border px-3 py-2 text-sm ${
                  displayStatus === 'verified' || displayStatus === 'simulated'
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : displayStatus === 'failed'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-yellow-200 bg-yellow-50 text-yellow-800'
                }`}
              >
                {displayStatus === 'verified'
                  ? 'Blockchain certificate is ready.'
                  : displayStatus === 'simulated'
                    ? 'Provenance record prepared — VeChain trust layer simulated. You can open the passport now.'
                    : displayStatus === 'failed'
                      ? (certificate?.failureReason ??
                        'Verification failed. The passport is saved and can be retried.')
                      : 'Preparing the tamper-evident trust record…'}
              </div>

              {verificationError && (
                <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                  {verificationError}
                </div>
              )}

              {certificate?.certificateHash && (
                <dl className="text-sm space-y-2">
                  <div className="flex gap-4">
                    <dt className="text-gray-500 w-32 shrink-0">Certificate hash</dt>
                    <dd className="font-mono text-xs break-all">{certificate.certificateHash}</dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          {step === 'verification' ? (
            <>
              <Button type="button" variant="outline" onClick={() => router.push('/passports')}>
                Back to passports
              </Button>
              <Button
                type="button"
                className="bg-brand-600 hover:bg-brand-700"
                onClick={() => createdPassportId && router.push(`/passports/${createdPassportId}`)}
                disabled={!createdPassportId}
              >
                {displayStatus === 'verified' || displayStatus === 'simulated'
                  ? 'Open passport'
                  : 'Open passport anyway'}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={goPrev}
                disabled={currentIndex === 0}
              >
                Back
              </Button>
              {step !== 'review' ? (
                <Button type="button" onClick={goNext} className="bg-brand-600 hover:bg-brand-700">
                  Continue
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-brand-600 hover:bg-brand-700"
                >
                  {isSubmitting ? 'Registering…' : 'Register material'}
                </Button>
              )}
            </>
          )}
        </div>
      </form>
      <aside className="hidden lg:block lg:w-[300px] lg:shrink-0 lg:sticky lg:top-20">
        {preview}
      </aside>
    </div>
  );
}
