'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { quality } from '@/lib/api-client';
import { getToken } from '@/lib/auth';
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

  const [form, setForm] = useState({
    passportId,
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

    const token = getToken();
    if (!token) {
      router.push('/login');
      return;
    }

    try {
      const payload: Parameters<typeof quality.submit>[0] = {
        passportId: form.passportId,
        photoUrls: [],
      };
      if (form.reportNotes) payload.reportNotes = form.reportNotes;

      if (form.structuralScore) payload.structuralScore = parseInt(form.structuralScore, 10);
      if (form.aestheticScore) payload.aestheticScore = parseInt(form.aestheticScore, 10);
      if (form.environmentalScore)
        payload.environmentalScore = parseInt(form.environmentalScore, 10);
      if (form.overallGrade) payload.overallGrade = form.overallGrade;

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

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Submit Quality Report</h1>
          <p className="text-gray-500 text-sm mt-1">
            Assess the condition of this material for reuse
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Passport ID */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Material passport</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <Label htmlFor="passportId">Passport ID</Label>
                <Input
                  id="passportId"
                  name="passportId"
                  value={form.passportId}
                  onChange={handleChange}
                  placeholder="UUID of the material passport"
                  required
                />
              </div>
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
              <CardTitle className="text-base">Overall condition grade</CardTitle>
            </CardHeader>
            <CardContent>
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

          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={submitting || !form.passportId}
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
