'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { quality, type InspectionMaterial } from '@/lib/api-client';
import { canViewQuality, getToken, getUser, type StoredUser } from '@/lib/auth';
import { NoAccess } from '@/components/ui/load-state';
import { MaterialPicker } from '@/components/quality/MaterialPicker';
import { MaterialUnderInspection } from '@/components/quality/MaterialUnderInspection';
import { getErrorMessage } from '@/lib/api-errors';

const GRADES = ['A', 'B', 'C', 'D'] as const;
type Grade = (typeof GRADES)[number];

const GRADE_DESCRIPTIONS: Record<Grade, string> = {
  A: 'Excellent — like new, minimal wear',
  B: 'Good — minor cosmetic wear, structurally sound',
  C: 'Fair — noticeable wear, usable with considerations',
  D: 'Poor — significant wear, limited reuse applications',
};

export default function SubmitQualityReportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const passportId = searchParams.get('passportId') ?? '';
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<StoredUser | null>(null);
  const [material, setMaterial] = useState<InspectionMaterial | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Arriving from a material's page or the work queue (?passportId=…) starts
  // with that material already chosen.
  useEffect(() => {
    const current = getToken();
    const currentUser = getUser();
    setToken(current);
    setUser(currentUser);
    if (!current || !passportId || !canViewQuality(currentUser)) return;
    quality
      .materials({ q: passportId, limit: 5 }, current)
      .then((res) => {
        const found = res.data.find((m) => m.id === passportId) ?? null;
        setMaterial(found);
        setNotFound(!found);
      })
      .catch(() => setNotFound(true));
  }, [passportId]);

  // A hub's report is its own check of its own material, and the passport
  // says so. Only an inspector's report is an independent inspection.
  const ownCheck = user?.role === 'hub_admin';

  const [form, setForm] = useState({
    structuralScore: '',
    aestheticScore: '',
    environmentalScore: '',
    overallGrade: '' as Grade | '',
    reportNotes: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    if (!token) {
      router.push('/login');
      return;
    }
    if (!material) {
      setError('Choose the material this report is about.');
      setSubmitting(false);
      return;
    }
    if (!form.overallGrade) {
      setError('Choose an overall grade: a report needs a verdict.');
      setSubmitting(false);
      return;
    }

    try {
      const payload: Parameters<typeof quality.submit>[0] = {
        passportId: material.id,
        overallGrade: form.overallGrade,
        photoUrls: [],
      };
      if (form.reportNotes) payload.reportNotes = form.reportNotes;

      if (form.structuralScore) payload.structuralScore = parseInt(form.structuralScore, 10);
      if (form.aestheticScore) payload.aestheticScore = parseInt(form.aestheticScore, 10);
      if (form.environmentalScore)
        payload.environmentalScore = parseInt(form.environmentalScore, 10);

      await quality.submit(payload, token);
      router.push('/quality');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'submit this report'));
    } finally {
      setSubmitting(false);
    }
  }

  const computedGrade = (): Grade | null => {
    const scores = [form.structuralScore, form.aestheticScore, form.environmentalScore]
      .map(Number)
      .filter(Boolean);
    if (!scores.length) return null;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg >= 8.5) return 'A';
    if (avg >= 6.5) return 'B';
    if (avg >= 4.5) return 'C';
    return 'D';
  };

  const suggested = computedGrade();

  if (user && !canViewQuality(user)) {
    return (
      <DashboardLayout>
        <div className="max-w-2xl mx-auto space-y-6">
          <h1 className="text-2xl font-bold">Submit Quality Report</h1>
          <NoAccess message="Quality reports are filed by inspectors, hub administrators and the platform." />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Submit Quality Report</h1>
          <p className="text-gray-500 text-sm mt-1">
            Choose the material, then assess its condition for reuse
          </p>
        </div>

        {ownCheck && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            This report is your hub&apos;s own check of its own material. The passport will show it
            as the seller&apos;s own check, not as an independent inspection.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* The material */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {material
                  ? ownCheck
                    ? 'Material being checked'
                    : 'Material being inspected'
                  : ownCheck
                    ? 'Which material are you checking?'
                    : 'Which material are you inspecting?'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {notFound && !material && (
                <p role="status" className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                  The material in that link isn&apos;t among the registered materials you can report
                  on. Choose one below.
                </p>
              )}
              {material ? (
                <MaterialUnderInspection material={material} onChange={() => setMaterial(null)} />
              ) : token ? (
                <MaterialPicker
                  token={token}
                  onSelect={setMaterial}
                  actionLabel={ownCheck ? 'Check' : 'Inspect'}
                />
              ) : (
                <p className="text-sm text-gray-400">Loading…</p>
              )}
            </CardContent>
          </Card>

          {/* Scores */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Condition scores (1–10)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(
                [
                  [
                    'structuralScore',
                    'Structural integrity',
                    'Load-bearing capacity, connections, deformation',
                  ],
                  [
                    'aestheticScore',
                    'Aesthetic condition',
                    'Surface finish, visible defects, weathering',
                  ],
                  [
                    'environmentalScore',
                    'Environmental quality',
                    'Contamination, hazardous substance checks',
                  ],
                ] as const
              ).map(([name, label, hint]) => (
                <div key={name} className="space-y-1">
                  <Label htmlFor={name}>{label}</Label>
                  <p className="text-xs text-gray-400">{hint}</p>
                  <Input
                    id={name}
                    name={name}
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={form[name as keyof typeof form]}
                    onChange={handleChange}
                    placeholder="1–10"
                    className="w-28"
                  />
                </div>
              ))}

              {suggested && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm">
                  <span className="text-blue-700 font-medium">Suggested grade: </span>
                  <span className="font-bold text-blue-900">{suggested}</span>
                  <span className="text-blue-600 ml-2">— {GRADE_DESCRIPTIONS[suggested]}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Overall grade */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Overall condition grade{' '}
                <span className="font-normal text-gray-500">(required)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {ownCheck && material?.lastIndependentInspectionAt && (
                <p className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                  An independent inspection has graded this material. Your check will be recorded
                  with the grade you give, but the passport keeps the inspection&apos;s grade.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {GRADES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, overallGrade: g }))}
                    className={`rounded-lg border-2 p-3 text-center transition-colors ${
                      form.overallGrade === g
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="text-2xl font-bold">{g}</div>
                    <div className="text-xs text-gray-500 mt-1 leading-tight">
                      {GRADE_DESCRIPTIONS[g]!.split('—')[0]!.trim()}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Inspection notes</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                name="reportNotes"
                value={form.reportNotes}
                onChange={handleChange}
                rows={5}
                placeholder="Detailed observations, reuse recommendations, handling requirements..."
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
            </CardContent>
          </Card>

          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {material && !form.overallGrade && (
            <p className="text-sm text-gray-500">Choose an overall grade to submit the report.</p>
          )}

          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={submitting || !material || !form.overallGrade}
              className="bg-brand-600 hover:bg-brand-700"
            >
              {submitting ? 'Submitting…' : 'Submit report'}
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
