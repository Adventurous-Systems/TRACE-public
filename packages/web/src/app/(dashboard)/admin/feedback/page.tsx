'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StarRating } from '@/components/ui/star-rating';
import { feedback, type FeedbackEntry } from '@/lib/api-client';
import { getToken, getUser } from '@/lib/auth';
import { getErrorMessage } from '@/lib/api-errors';

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug',
  ux: 'UX / Design',
  feature: 'Feature request',
  general: 'General',
};

const CATEGORY_COLORS: Record<string, string> = {
  bug: 'bg-red-100 text-red-700',
  ux: 'bg-blue-100 text-blue-700',
  feature: 'bg-green-100 text-green-700',
  general: 'bg-gray-100 text-gray-700',
};

export default function AdminFeedbackPage() {
  const router = useRouter();
  const [items, setItems] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    const user = getUser();
    if (!token || !user) {
      router.replace('/login');
      return;
    }
    if (user.role !== 'platform_admin' && user.role !== 'hub_admin') {
      router.replace('/dashboard');
      return;
    }
    feedback
      .list(token)
      .then(setItems)
      .catch((e: unknown) => setError(getErrorMessage(e, 'load feedback')))
      .finally(() => setLoading(false));
  }, [router]);

  const avgRating = items.length
    ? (items.reduce((s, i) => s + i.rating, 0) / items.length).toFixed(1)
    : '—';

  const countByCategory = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.category] = (acc[i.category] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Workshop Feedback</h1>
          <p className="text-gray-500 text-sm mt-1">
            {items.length} submission{items.length !== 1 ? 's' : ''} collected
          </p>
        </div>

        {/* Summary cards */}
        {items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{avgRating}</div>
                <div className="text-xs text-gray-500 mt-1">Avg rating</div>
              </CardContent>
            </Card>
            {(['bug', 'ux', 'feature', 'general'] as const).map((c) => (
              <Card key={c}>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{countByCategory[c] ?? 0}</div>
                  <div className="text-xs text-gray-500 mt-1">{CATEGORY_LABELS[c]}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Feedback list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All submissions</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-gray-400">Loading…</p>}
            {error && <p className="text-sm text-red-500">{error}</p>}
            {!loading && !error && items.length === 0 && (
              <p className="text-sm text-gray-500">No feedback submitted yet.</p>
            )}
            {!loading && items.length > 0 && (
              <div className="divide-y">
                {items.map((item) => (
                  <div key={item.id} className="py-4 space-y-1.5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <StarRating rating={item.rating} />
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[item.category] ?? ''}`}
                      >
                        {CATEGORY_LABELS[item.category] ?? item.category}
                      </span>
                      {item.user && (
                        <span className="text-xs text-gray-500">
                          {item.user.name} · {item.user.email}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 ml-auto">
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{item.message}</p>
                    {item.pageUrl && (
                      <p className="text-xs text-gray-400 truncate">
                        Page:{' '}
                        <a
                          href={item.pageUrl}
                          className="hover:underline"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {item.pageUrl}
                        </a>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
