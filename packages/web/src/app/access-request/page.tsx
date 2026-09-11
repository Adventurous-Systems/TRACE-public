'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { accessRequests } from '@/lib/api-client';
import { clearSession, getSession, type StoredUser } from '@/lib/auth';
import { getErrorMessage } from '@/lib/api-errors';
import { track } from '@/lib/analytics';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/ui/Logo';

const AccessRequestSchema = z.object({
  requestedRole: z.enum(['hub_staff', 'hub_admin']),
  organisationName: z.string().min(1, 'Organisation or hub name is required'),
  notes: z.string().max(1000, 'Please keep notes under 1000 characters').optional(),
});

type AccessRequestForm = z.infer<typeof AccessRequestSchema>;

type AccessRequestSummary = {
  status: string;
  requestedRole: string;
  organisationName: string | null;
  reviewNotes: string | null;
};

function formatStatus(status: string) {
  return status.replace(/_/g, ' ');
}

export default function AccessRequestPage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pendingRequest, setPendingRequest] = useState<AccessRequestSummary | null>(null);
  const [latestReviewedRequest, setLatestReviewedRequest] = useState<AccessRequestSummary | null>(
    null,
  );
  const [loadingRequest, setLoadingRequest] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AccessRequestForm>({
    resolver: zodResolver(AccessRequestSchema),
    defaultValues: {
      requestedRole: 'hub_staff',
      organisationName: '',
      notes: '',
    },
  });

  useEffect(() => {
    const session = getSession();
    setToken(session.token);
    setUser(session.user);
    setSessionReady(true);
  }, []);

  useEffect(() => {
    if (!sessionReady) {
      return;
    }

    if (!token || !user) {
      router.replace('/login');
      return;
    }

    if (user.role !== 'buyer') {
      router.replace('/dashboard');
      return;
    }

    let cancelled = false;
    accessRequests
      .mine(token)
      .then((requests) => {
        if (cancelled) return;

        const summaries = requests.map((request) => ({
          status: request.status,
          requestedRole: request.requestedRole,
          organisationName: request.organisationName,
          reviewNotes: request.reviewNotes,
        }));

        const nextPending = summaries.find((request) => request.status === 'pending') ?? null;
        const nextReviewed = summaries.find((request) => request.status !== 'pending') ?? null;

        setPendingRequest(nextPending);
        setLatestReviewedRequest(nextReviewed);
        setServerError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // getErrorMessage already maps 429 to the same wording this used to
        // special-case here.
        setServerError(getErrorMessage(err, 'load your access request'));
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingRequest(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [router, sessionReady, token, user]);

  const reviewedMessage = useMemo(() => {
    if (!latestReviewedRequest) return null;

    if (latestReviewedRequest.status === 'approved') {
      return 'Your previous seller access was closed. You can submit a fresh request below to start again.';
    }

    if (latestReviewedRequest.status === 'rejected') {
      return 'Your last request was rejected. You can update the details and submit a new request below.';
    }

    return null;
  }, [latestReviewedRequest]);

  async function onSubmit(data: AccessRequestForm) {
    setServerError(null);
    setSuccessMessage(null);
    if (!token) {
      router.replace('/login');
      return;
    }

    try {
      const created = await accessRequests.submit(
        {
          requestedRole: data.requestedRole,
          organisationName: data.organisationName,
          ...(data.notes?.trim() ? { notes: data.notes.trim() } : {}),
        },
        token,
      );
      track('access-request', {
        requestedRole: data.requestedRole,
        hasNotes: Boolean(data.notes?.trim()),
      });
      setPendingRequest({
        status: created.status,
        requestedRole: created.requestedRole,
        organisationName: created.organisationName,
        reviewNotes: created.reviewNotes,
      });
      setLatestReviewedRequest(null);
      setSuccessMessage(
        'Request submitted. Once approved, sign out and sign back in to refresh your access.',
      );
      reset({
        requestedRole: 'hub_staff',
        organisationName: '',
        notes: '',
      });
    } catch (err) {
      setServerError(getErrorMessage(err, 'submit this request'));
    }
  }

  function handleSignOut() {
    clearSession();
    router.push('/login');
  }

  if (!sessionReady || !user) {
    return null;
  }

  if (user.role !== 'buyer') {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 flex items-center justify-between h-14">
          <Link href="/marketplace" className="flex items-center" aria-label="TRACE home">
            <Logo className="h-7" />
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 hidden sm:block">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Request seller access</h1>
          <p className="text-gray-500 mt-1">
            Ask for beta access to list materials and manage a hub organisation.
          </p>
        </div>

        {loadingRequest ? (
          <Card>
            <CardContent className="py-8 text-sm text-gray-400">
              Loading request status…
            </CardContent>
          </Card>
        ) : serverError && !pendingRequest && !latestReviewedRequest ? (
          <Card>
            <CardHeader>
              <CardTitle>Unable to load request status</CardTitle>
              <CardDescription>Please try again once the connection settles.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                {serverError}
              </div>
              <Button onClick={() => window.location.reload()}>Retry</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {pendingRequest && (
              <Card>
                <CardHeader>
                  <CardTitle>Current request</CardTitle>
                  <CardDescription>Your active access request</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p>
                    <span className="font-medium">Status:</span>{' '}
                    {formatStatus(pendingRequest.status)}
                  </p>
                  <p>
                    <span className="font-medium">Requested access:</span>{' '}
                    {pendingRequest.requestedRole.replace('_', ' ')}
                  </p>
                  {pendingRequest.organisationName && (
                    <p>
                      <span className="font-medium">Organisation:</span>{' '}
                      {pendingRequest.organisationName}
                    </p>
                  )}
                  {pendingRequest.reviewNotes && (
                    <p>
                      <span className="font-medium">Review notes:</span>{' '}
                      {pendingRequest.reviewNotes}
                    </p>
                  )}
                  <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-700">
                    Your request is pending review.
                  </div>
                </CardContent>
              </Card>
            )}

            {!pendingRequest && latestReviewedRequest && (
              <Card>
                <CardHeader>
                  <CardTitle>Previous request</CardTitle>
                  <CardDescription>Your most recent reviewed access request</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p>
                    <span className="font-medium">Status:</span>{' '}
                    {formatStatus(latestReviewedRequest.status)}
                  </p>
                  <p>
                    <span className="font-medium">Requested access:</span>{' '}
                    {latestReviewedRequest.requestedRole.replace('_', ' ')}
                  </p>
                  {latestReviewedRequest.organisationName && (
                    <p>
                      <span className="font-medium">Organisation:</span>{' '}
                      {latestReviewedRequest.organisationName}
                    </p>
                  )}
                  {latestReviewedRequest.reviewNotes && (
                    <p>
                      <span className="font-medium">Review notes:</span>{' '}
                      {latestReviewedRequest.reviewNotes}
                    </p>
                  )}
                  {reviewedMessage && (
                    <div className="rounded-md bg-blue-50 px-3 py-2 text-blue-700">
                      {reviewedMessage}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {!pendingRequest && (
              <Card>
                <CardHeader>
                  <CardTitle>Submit request</CardTitle>
                  <CardDescription>
                    Your account will stay as a buyer until an internal admin approves this request.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="space-y-1">
                      <Label htmlFor="requestedRole">Requested access level</Label>
                      <select
                        id="requestedRole"
                        {...register('requestedRole')}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="hub_staff">Hub staff</option>
                        <option value="hub_admin">Hub admin</option>
                      </select>
                      {errors.requestedRole && (
                        <p className="text-sm text-red-500">{errors.requestedRole.message}</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="organisationName">Organisation or hub name</Label>
                      <Input
                        id="organisationName"
                        type="text"
                        placeholder="Stirling Reuse Hub"
                        {...register('organisationName')}
                      />
                      {errors.organisationName && (
                        <p className="text-sm text-red-500">{errors.organisationName.message}</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="notes">Reason or beta context</Label>
                      <textarea
                        id="notes"
                        rows={4}
                        placeholder="Tell us why you need access and what you want to test."
                        {...register('notes')}
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      {errors.notes && (
                        <p className="text-sm text-red-500">{errors.notes.message}</p>
                      )}
                    </div>
                    {serverError && (
                      <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                        {serverError}
                      </div>
                    )}
                    {successMessage && (
                      <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                        {successMessage}
                      </div>
                    )}
                    <Button
                      type="submit"
                      className="w-full bg-brand-600 hover:bg-brand-700"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Submitting...' : 'Submit request'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
