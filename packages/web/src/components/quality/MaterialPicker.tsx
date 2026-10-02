'use client';

import { useEffect, useRef, useState } from 'react';
import { MATERIAL_CATEGORIES } from '@trace/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { quality, type InspectionMaterial } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/api-errors';
import { categoryLabel } from '@/lib/categories';
import { formatDate } from '@/lib/format';
import { ListingPhoto } from '@/components/marketplace/ListingPhoto';

const PAGE_SIZE = 8;

/** When a material was last inspected by an inspector, in a sentence. */
export function inspectionStatus(material: InspectionMaterial): string {
  return material.lastIndependentInspectionAt
    ? `Last inspected ${formatDate(material.lastIndependentInspectionAt)}`
    : 'Not yet independently inspected';
}

/**
 * Find the material to inspect: search by name, serial number or passport ID,
 * narrow by category or to those not yet inspected, then pick one. Replaces a
 * field that asked the inspector to type the passport's UUID.
 */
export function MaterialPicker({
  token,
  onSelect,
}: {
  token: string;
  onSelect: (material: InspectionMaterial) => void;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [uninspected, setUninspected] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: InspectionMaterial[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only the newest request may fill the list: a slow early search must not
  // overwrite the results of what the inspector typed next.
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    const timer = setTimeout(
      () => {
        quality
          .materials(
            { q: search.trim(), categoryL1: category, uninspected, page, limit: PAGE_SIZE },
            token,
          )
          .then((res) => {
            if (request !== latest.current) return;
            setResult({ items: res.data, total: res.total });
            setError(null);
          })
          .catch((e: unknown) => {
            if (request !== latest.current) return;
            setError(getErrorMessage(e, 'load the materials'));
          });
      },
      search ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [search, category, uninspected, page, token]);

  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Search materials"
          placeholder="Search by name, serial number or passport ID"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="min-w-0 flex-1 basis-64"
        />
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All categories</option>
          {MATERIAL_CATEGORIES.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={uninspected}
          onChange={(e) => {
            setUninspected(e.target.checked);
            setPage(1);
          }}
          className="h-4 w-4 rounded border-gray-300 text-brand-600"
        />
        Only materials not yet independently inspected
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!result && !error && <p className="text-sm text-gray-400">Loading materials…</p>}
      {result && result.items.length === 0 && (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-gray-500">
          No registered material matches. Check the spelling, or clear the filters.
        </p>
      )}

      {result && result.items.length > 0 && (
        <ul className="divide-y rounded-md border" aria-label="Materials">
          {result.items.map((m) => (
            <li key={m.id} className="flex items-center gap-3 p-3">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-gray-50">
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
              <Button type="button" size="sm" variant="outline" onClick={() => onSelect(m)}>
                Inspect
              </Button>
            </li>
          ))}
        </ul>
      )}

      {result && result.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            {result.total} materials · page {page} of {pages}
          </span>
          <span className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
