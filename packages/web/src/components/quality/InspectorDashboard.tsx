'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadFailure } from '@/components/ui/load-state';
import { quality, type InspectionMaterial } from '@/lib/api-client';
import { getToken } from '@/lib/auth';
import { getErrorMessage } from '@/lib/api-errors';
import { categoryLabel } from '@/lib/categories';
import { ListingPhoto } from '@/components/marketplace/ListingPhoto';
import { inspectionStatus } from './MaterialPicker';

interface Summary {
  materials: number;
  notIndependentlyInspected: number;
  myReports: number;
}

/**
 * An inspector's dashboard: how much there is to inspect, and the queue,
 * least recently inspected first. An inspector belongs to no organisation, so
 * the organisation dashboard had nothing to show them but dashes.
 */
export function InspectorDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [queue, setQueue] = useState<InspectionMaterial[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    const token = getToken();
    if (!token) return;
    setError(null);
    Promise.all([quality.summary(token), quality.materials({ limit: 6 }, token)])
      .then(([counts, materials]) => {
        setSummary(counts);
        setQueue(materials.data);
      })
      .catch((e: unknown) => setError(getErrorMessage(e, 'load your inspection queue')));
  }
  useEffect(load, []);

  const tiles: Array<[string, number | undefined]> = [
    ['Registered materials', summary?.materials],
    ['Not yet independently inspected', summary?.notIndependentlyInspected],
    ['Reports you have filed', summary?.myReports],
  ];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {tiles.map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{value ?? '—'}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Next to inspect</CardTitle>
          <Link href="/quality/new" className="text-sm text-brand-600 hover:underline">
            Search all materials
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {error && <LoadFailure message={error} onRetry={load} />}
          {!error && queue === null && (
            <div className="px-6 py-8 text-center text-gray-400 text-sm">Loading…</div>
          )}
          {queue?.length === 0 && (
            <div className="px-6 py-8 text-center text-gray-400 text-sm">
              No materials are registered yet.
            </div>
          )}
          {queue && queue.length > 0 && (
            <ul className="divide-y">
              {queue.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-6 py-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-gray-50">
                    <ListingPhoto src={m.photo} alt="" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.productName}</p>
                    <p className="truncate text-xs text-gray-500">
                      {categoryLabel(m.categoryL1, m.categoryL2)} · {m.organisationName}
                      {m.conditionGrade ? ` · Grade ${m.conditionGrade}` : ''}
                    </p>
                    <p
                      className={`text-xs ${m.lastIndependentInspectionAt ? 'text-gray-500' : 'text-amber-700'}`}
                    >
                      {inspectionStatus(m)}
                    </p>
                  </div>
                  <Link href={`/quality/new?passportId=${m.id}`}>
                    <Button size="sm" variant="outline">
                      Inspect
                    </Button>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
