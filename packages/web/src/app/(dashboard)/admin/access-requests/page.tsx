'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  accessRequests,
  type AccessRequestOrganisation,
  type AccessRequestReview,
} from '@/lib/api-client';
import { getSession, type StoredUser } from '@/lib/auth';
import { getErrorMessage } from '@/lib/api-errors';

type AdminView = 'pending' | 'approved' | 'organisations';
type PendingStatusFilter = 'pending' | 'rejected';

interface PendingDraft {
  requestedRole: 'hub_staff' | 'hub_admin';
  organisationName: string;
  notes: string;
  reviewNotes: string;
}

interface ApprovedDraft {
  role: 'buyer' | 'hub_staff' | 'hub_admin';
  organisationId: string;
  organisationName: string;
  reviewNotes: string;
}

interface OrganisationDraft {
  name: string;
  verified: boolean;
}

const VIEW_OPTIONS: AdminView[] = ['pending', 'approved', 'organisations'];
const PENDING_FILTERS: PendingStatusFilter[] = ['pending', 'rejected'];

function formatRole(role: string) {
  return role.replace(/_/g, ' ');
}

function formatDate(value: string | null) {
  if (!value) return 'Not reviewed yet';
  return new Date(value).toLocaleString();
}

export default function AdminAccessRequestsPage() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [view, setView] = useState<AdminView>('pending');
  const [pendingFilter, setPendingFilter] = useState<PendingStatusFilter>('pending');
  const [requests, setRequests] = useState<AccessRequestReview[]>([]);
  const [organisations, setOrganisations] = useState<AccessRequestOrganisation[]>([]);
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, PendingDraft>>({});
  const [approvedDrafts, setApprovedDrafts] = useState<Record<string, ApprovedDraft>>({});
  const [organisationDrafts, setOrganisationDrafts] = useState<Record<string, OrganisationDraft>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const loadingRef = useRef(false);

  useEffect(() => {
    const session = getSession();
    setToken(session.token);
    setUser(session.user);
    setSessionReady(true);
  }, []);

  const loadData = useCallback(async () => {
    if (!token || !user || user.role !== 'platform_admin' || loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const organisationData = await accessRequests.organisations(token);
      setOrganisations(organisationData);

      if (view === 'organisations') {
        setRequests([]);
      } else {
        const status = view === 'approved' ? 'approved' : pendingFilter;
        const requestData = await accessRequests.list(token, status);
        setRequests(requestData);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'load access management data'));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [pendingFilter, token, user, view]);

  useEffect(() => {
    if (!sessionReady) {
      return;
    }

    if (!token) {
      setError('Missing session token. Please sign in again.');
      setLoading(false);
      return;
    }

    if (!user) {
      setLoading(false);
      return;
    }

    if (user.role !== 'platform_admin') {
      setLoading(false);
      return;
    }

    void loadData();
  }, [loadData, loadVersion, sessionReady, token, user]);

  useEffect(() => {
    if (requests.length === 0) {
      return;
    }

    setPendingDrafts((current) => {
      const next = { ...current };
      let changed = false;

      for (const request of requests) {
        if (request.status !== 'pending' || next[request.id]) continue;
        next[request.id] = {
          requestedRole: request.requestedRole,
          organisationName: request.organisationName ?? '',
          notes: request.notes ?? '',
          reviewNotes: request.reviewNotes ?? '',
        };
        changed = true;
      }

      return changed ? next : current;
    });

    setApprovedDrafts((current) => {
      const next = { ...current };
      let changed = false;

      for (const request of requests) {
        if (request.status !== 'approved' || next[request.id]) continue;
        next[request.id] = {
          role:
            request.user?.role === 'buyer' ||
            request.user?.role === 'hub_staff' ||
            request.user?.role === 'hub_admin'
              ? request.user.role
              : 'hub_staff',
          organisationId: request.targetOrganisationId ?? request.user?.organisationId ?? '',
          organisationName: request.targetOrganisation?.name ?? request.organisationName ?? '',
          reviewNotes: request.reviewNotes ?? '',
        };
        changed = true;
      }

      return changed ? next : current;
    });
  }, [requests]);

  useEffect(() => {
    if (organisations.length === 0) {
      return;
    }

    setOrganisationDrafts((current) => {
      const next = { ...current };
      let changed = false;

      for (const organisation of organisations) {
        if (next[organisation.id]) continue;
        next[organisation.id] = {
          name: organisation.name,
          verified: organisation.verified,
        };
        changed = true;
      }

      return changed ? next : current;
    });
  }, [organisations]);

  const sectionDescription = useMemo(() => {
    if (view === 'pending') {
      return `${requests.length} ${pendingFilter} request${requests.length === 1 ? '' : 's'}`;
    }
    if (view === 'approved') {
      return `${requests.length} approved access record${requests.length === 1 ? '' : 's'}`;
    }
    return `${organisations.length} organisation${organisations.length === 1 ? '' : 's'}`;
  }, [organisations.length, pendingFilter, requests.length, view]);

  function refreshData() {
    setLoadVersion((current) => current + 1);
  }

  function updatePendingDraft(id: string, updates: Partial<PendingDraft>) {
    setPendingDrafts((current) => ({
      ...current,
      [id]: {
        requestedRole: current[id]?.requestedRole ?? 'hub_staff',
        organisationName: current[id]?.organisationName ?? '',
        notes: current[id]?.notes ?? '',
        reviewNotes: current[id]?.reviewNotes ?? '',
        ...updates,
      },
    }));
  }

  function updateApprovedDraft(id: string, updates: Partial<ApprovedDraft>) {
    setApprovedDrafts((current) => ({
      ...current,
      [id]: {
        role: current[id]?.role ?? 'hub_staff',
        organisationId: current[id]?.organisationId ?? '',
        organisationName: current[id]?.organisationName ?? '',
        reviewNotes: current[id]?.reviewNotes ?? '',
        ...updates,
      },
    }));
  }

  function updateOrganisationDraft(id: string, updates: Partial<OrganisationDraft>) {
    setOrganisationDrafts((current) => ({
      ...current,
      [id]: {
        name: current[id]?.name ?? '',
        verified: current[id]?.verified ?? false,
        ...updates,
      },
    }));
  }

  async function handleSavePending(requestId: string) {
    if (!token) return;
    const draft = pendingDrafts[requestId];
    if (!draft?.organisationName.trim()) {
      setError('Organisation name is required for pending requests.');
      return;
    }

    setBusyKey(`save-pending-${requestId}`);
    setError(null);
    try {
      await accessRequests.updatePending(
        requestId,
        {
          requestedRole: draft.requestedRole,
          organisationName: draft.organisationName.trim(),
          ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
          ...(draft.reviewNotes.trim() ? { reviewNotes: draft.reviewNotes.trim() } : {}),
        },
        token,
      );
      refreshData();
    } catch (err) {
      setError(getErrorMessage(err, 'update this request'));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleApprove(requestId: string) {
    if (!token) return;
    const draft = pendingDrafts[requestId];
    if (!draft?.organisationName.trim()) {
      setError(
        'Choose an existing organisation or enter a new organisation name before approving.',
      );
      return;
    }

    setBusyKey(`approve-${requestId}`);
    setError(null);
    try {
      await accessRequests.approve(
        requestId,
        {
          role: draft.requestedRole,
          organisationName: draft.organisationName.trim(),
          ...(draft.reviewNotes.trim() ? { reviewNotes: draft.reviewNotes.trim() } : {}),
        },
        token,
      );
      refreshData();
    } catch (err) {
      setError(getErrorMessage(err, 'approve this request'));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleReject(requestId: string) {
    if (!token) return;
    const draft = pendingDrafts[requestId];

    setBusyKey(`reject-${requestId}`);
    setError(null);
    try {
      await accessRequests.reject(
        requestId,
        {
          ...(draft?.reviewNotes.trim() ? { reviewNotes: draft.reviewNotes.trim() } : {}),
        },
        token,
      );
      refreshData();
    } catch (err) {
      setError(getErrorMessage(err, 'reject this request'));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSaveApproved(requestId: string) {
    if (!token) return;
    const draft = approvedDrafts[requestId];
    if (!draft) return;

    if (draft.role !== 'buyer' && !draft.organisationId && !draft.organisationName.trim()) {
      setError('Approved hub users need an organisation.');
      return;
    }

    setBusyKey(`save-approved-${requestId}`);
    setError(null);
    try {
      await accessRequests.updateApprovedUser(
        requestId,
        {
          role: draft.role,
          ...(draft.role !== 'buyer' && draft.organisationId
            ? { organisationId: draft.organisationId }
            : {}),
          ...(draft.role !== 'buyer' && draft.organisationName.trim()
            ? { organisationName: draft.organisationName.trim() }
            : {}),
          ...(draft.reviewNotes.trim() ? { reviewNotes: draft.reviewNotes.trim() } : {}),
        },
        token,
      );
      refreshData();
    } catch (err) {
      setError(getErrorMessage(err, 'update this access'));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRevokeAccess(requestId: string) {
    if (!token) return;
    const draft = approvedDrafts[requestId];

    setBusyKey(`revoke-${requestId}`);
    setError(null);
    try {
      await accessRequests.updateApprovedUser(
        requestId,
        {
          role: 'buyer',
          reviewNotes: draft?.reviewNotes.trim() || 'Access revoked by platform admin',
        },
        token,
      );
      refreshData();
    } catch (err) {
      setError(getErrorMessage(err, 'revoke this access'));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSaveOrganisation(organisationId: string) {
    if (!token) return;
    const draft = organisationDrafts[organisationId];
    if (!draft?.name.trim()) {
      setError('Organisation name cannot be empty.');
      return;
    }

    setBusyKey(`save-organisation-${organisationId}`);
    setError(null);
    try {
      await accessRequests.updateOrganisation(
        organisationId,
        {
          name: draft.name.trim(),
          verified: draft.verified,
        },
        token,
      );
      refreshData();
    } catch (err) {
      setError(getErrorMessage(err, 'update this organisation'));
    } finally {
      setBusyKey(null);
    }
  }

  if (!user || user.role !== 'platform_admin') {
    if (!sessionReady) {
      return null;
    }

    return (
      <DashboardLayout>
        <Card>
          <CardHeader>
            <CardTitle>Access management</CardTitle>
            <CardDescription>
              This page is only available to platform administrators.
            </CardDescription>
          </CardHeader>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Access management</h1>
            <p className="text-sm text-gray-500">
              Manage pending requests, approved hub access, and organisation records.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {VIEW_OPTIONS.map((option) => (
              <Button
                key={option}
                variant={view === option ? 'default' : 'outline'}
                className={view === option ? 'bg-brand-600 hover:bg-brand-700' : ''}
                onClick={() => setView(option)}
              >
                {option === 'approved' ? 'Approved access' : option}
              </Button>
            ))}
          </div>
        </div>

        {view === 'pending' && (
          <div className="flex flex-wrap items-center gap-2">
            {PENDING_FILTERS.map((filter) => (
              <Button
                key={filter}
                variant={pendingFilter === filter ? 'default' : 'outline'}
                className={pendingFilter === filter ? 'bg-brand-600 hover:bg-brand-700' : ''}
                onClick={() => setPendingFilter(filter)}
              >
                {formatRole(filter)}
              </Button>
            ))}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              {view === 'pending'
                ? 'Pending requests'
                : view === 'approved'
                  ? 'Approved access'
                  : 'Organisations'}
            </CardTitle>
            <CardDescription>{loading ? 'Loading...' : sectionDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
            )}

            {loading ? (
              <div className="text-sm text-gray-400">Loading access management data...</div>
            ) : error && requests.length === 0 && organisations.length === 0 ? (
              <div className="space-y-3">
                <div className="text-sm text-gray-500">
                  The access-management data could not be loaded.
                </div>
                <Button variant="outline" onClick={refreshData}>
                  Retry
                </Button>
              </div>
            ) : view === 'organisations' ? (
              organisations.length === 0 ? (
                <div className="text-sm text-gray-500">No organisations available.</div>
              ) : (
                <div className="space-y-4">
                  {organisations.map((organisation) => {
                    const draft = organisationDrafts[organisation.id];
                    const isBusy = busyKey === `save-organisation-${organisation.id}`;

                    return (
                      <div
                        key={organisation.id}
                        className="rounded-lg border bg-white p-4 space-y-4"
                      >
                        <div className="flex flex-col gap-1">
                          <p className="font-semibold">{organisation.name}</p>
                          <p className="text-xs text-gray-500">
                            Slug: {organisation.slug} · Type: {organisation.type}
                          </p>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-1">
                            <Label htmlFor={`${organisation.id}-name`}>Organisation name</Label>
                            <input
                              id={`${organisation.id}-name`}
                              value={draft?.name ?? organisation.name}
                              onChange={(event) =>
                                updateOrganisationDraft(organisation.id, {
                                  name: event.target.value,
                                })
                              }
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            />
                          </div>
                          <label className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              checked={draft?.verified ?? organisation.verified}
                              onChange={(event) =>
                                updateOrganisationDraft(organisation.id, {
                                  verified: event.target.checked,
                                })
                              }
                            />
                            Verified organisation
                          </label>
                        </div>
                        <Button
                          className="bg-brand-600 hover:bg-brand-700"
                          disabled={isBusy}
                          onClick={() => handleSaveOrganisation(organisation.id)}
                        >
                          {isBusy ? 'Saving...' : 'Update organisation'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )
            ) : requests.length === 0 ? (
              <div className="text-sm text-gray-500">
                No {view === 'approved' ? 'approved access records' : pendingFilter + ' requests'}{' '}
                right now.
              </div>
            ) : view === 'approved' ? (
              <div className="space-y-4">
                {requests.map((request) => {
                  const draft = approvedDrafts[request.id];
                  const saveBusy = busyKey === `save-approved-${request.id}`;
                  const revokeBusy = busyKey === `revoke-${request.id}`;

                  return (
                    <div key={request.id} className="rounded-lg border bg-white p-4 space-y-4">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1">
                          <p className="font-semibold">
                            {request.user?.name || 'Unknown user'}{' '}
                            <span className="font-normal text-gray-500">
                              ({request.user?.email || request.userId})
                            </span>
                          </p>
                          <p className="text-sm text-gray-600">
                            Current access:{' '}
                            {request.user?.role ? formatRole(request.user.role) : 'unknown'} ·{' '}
                            {request.targetOrganisation?.name || 'no organisation'}
                          </p>
                        </div>
                        <div className="text-sm text-gray-500">
                          <p>Approved: {formatDate(request.reviewedAt)}</p>
                          <p>Updated: {formatDate(request.updatedAt)}</p>
                        </div>
                      </div>
                      <div className="grid gap-4 lg:grid-cols-3">
                        <div className="space-y-1">
                          <Label htmlFor={`${request.id}-approved-role`}>Role</Label>
                          <select
                            id={`${request.id}-approved-role`}
                            value={draft?.role ?? 'hub_staff'}
                            onChange={(event) =>
                              updateApprovedDraft(request.id, {
                                role: event.target.value as 'buyer' | 'hub_staff' | 'hub_admin',
                              })
                            }
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            <option value="hub_staff">Hub staff</option>
                            <option value="hub_admin">Hub admin</option>
                            <option value="buyer">Buyer</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`${request.id}-approved-organisation`}>
                            Organisation
                          </Label>
                          <select
                            id={`${request.id}-approved-organisation`}
                            value={draft?.organisationId ?? ''}
                            disabled={draft?.role === 'buyer'}
                            onChange={(event) =>
                              updateApprovedDraft(request.id, {
                                organisationId: event.target.value,
                                organisationName:
                                  organisations.find(
                                    (organisation) => organisation.id === event.target.value,
                                  )?.name ??
                                  draft?.organisationName ??
                                  '',
                              })
                            }
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:bg-gray-100"
                          >
                            <option value="">Create or use custom organisation name</option>
                            {organisations.map((organisation) => (
                              <option key={organisation.id} value={organisation.id}>
                                {organisation.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`${request.id}-approved-organisation-name`}>
                            Custom organisation name
                          </Label>
                          <input
                            id={`${request.id}-approved-organisation-name`}
                            value={draft?.organisationName ?? ''}
                            disabled={draft?.role === 'buyer'}
                            onChange={(event) =>
                              updateApprovedDraft(request.id, {
                                organisationId: '',
                                organisationName: event.target.value,
                              })
                            }
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:bg-gray-100"
                          />
                        </div>
                        <div className="space-y-1 lg:col-span-3">
                          <Label htmlFor={`${request.id}-approved-notes`}>Review notes</Label>
                          <textarea
                            id={`${request.id}-approved-notes`}
                            rows={3}
                            value={draft?.reviewNotes ?? ''}
                            onChange={(event) =>
                              updateApprovedDraft(request.id, { reviewNotes: event.target.value })
                            }
                            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          />
                        </div>
                        <div className="flex flex-wrap gap-2 lg:col-span-3">
                          <Button
                            className="bg-brand-600 hover:bg-brand-700"
                            disabled={saveBusy || revokeBusy}
                            onClick={() => handleSaveApproved(request.id)}
                          >
                            {saveBusy ? 'Saving...' : 'Update access'}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={saveBusy || revokeBusy}
                            onClick={() => handleRevokeAccess(request.id)}
                          >
                            {revokeBusy ? 'Saving...' : 'Revoke access'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-4">
                {requests.map((request) => {
                  const draft = pendingDrafts[request.id];
                  const saveBusy = busyKey === `save-pending-${request.id}`;
                  const approveBusy = busyKey === `approve-${request.id}`;
                  const rejectBusy = busyKey === `reject-${request.id}`;

                  return (
                    <div key={request.id} className="rounded-lg border bg-white p-4 space-y-4">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1">
                          <p className="font-semibold">
                            {request.user?.name || 'Unknown user'}{' '}
                            <span className="font-normal text-gray-500">
                              ({request.user?.email || request.userId})
                            </span>
                          </p>
                          <p className="text-sm text-gray-600">
                            Requested {formatRole(request.requestedRole)} for{' '}
                            <span className="font-medium">
                              {request.organisationName || 'unspecified organisation'}
                            </span>
                          </p>
                        </div>
                        <div className="text-sm text-gray-500">
                          <p>
                            Status:{' '}
                            <span className="font-medium text-gray-800">{request.status}</span>
                          </p>
                          <p>Submitted: {formatDate(request.createdAt)}</p>
                          <p>Reviewed: {formatDate(request.reviewedAt)}</p>
                        </div>
                      </div>

                      {request.status === 'pending' ? (
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="space-y-1">
                            <Label htmlFor={`${request.id}-pending-role`}>Requested role</Label>
                            <select
                              id={`${request.id}-pending-role`}
                              value={draft?.requestedRole ?? 'hub_staff'}
                              onChange={(event) =>
                                updatePendingDraft(request.id, {
                                  requestedRole: event.target.value as 'hub_staff' | 'hub_admin',
                                })
                              }
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            >
                              <option value="hub_staff">Hub staff</option>
                              <option value="hub_admin">Hub admin</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`${request.id}-pending-organisation`}>
                              Organisation name
                            </Label>
                            <input
                              id={`${request.id}-pending-organisation`}
                              value={draft?.organisationName ?? ''}
                              onChange={(event) =>
                                updatePendingDraft(request.id, {
                                  organisationName: event.target.value,
                                })
                              }
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            />
                          </div>
                          <div className="space-y-1 lg:col-span-2">
                            <Label htmlFor={`${request.id}-pending-notes`}>Request notes</Label>
                            <textarea
                              id={`${request.id}-pending-notes`}
                              rows={3}
                              value={draft?.notes ?? ''}
                              onChange={(event) =>
                                updatePendingDraft(request.id, { notes: event.target.value })
                              }
                              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            />
                          </div>
                          <div className="space-y-1 lg:col-span-2">
                            <Label htmlFor={`${request.id}-pending-review-notes`}>
                              Review notes
                            </Label>
                            <textarea
                              id={`${request.id}-pending-review-notes`}
                              rows={3}
                              value={draft?.reviewNotes ?? ''}
                              onChange={(event) =>
                                updatePendingDraft(request.id, { reviewNotes: event.target.value })
                              }
                              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2 lg:col-span-2">
                            <Button
                              variant="outline"
                              disabled={saveBusy || approveBusy || rejectBusy}
                              onClick={() => handleSavePending(request.id)}
                            >
                              {saveBusy ? 'Saving...' : 'Save changes'}
                            </Button>
                            <Button
                              className="bg-brand-600 hover:bg-brand-700"
                              disabled={saveBusy || approveBusy || rejectBusy}
                              onClick={() => handleApprove(request.id)}
                            >
                              {approveBusy ? 'Saving...' : 'Approve'}
                            </Button>
                            <Button
                              variant="outline"
                              disabled={saveBusy || approveBusy || rejectBusy}
                              onClick={() => handleReject(request.id)}
                            >
                              {rejectBusy ? 'Saving...' : 'Reject'}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
                          This request was rejected.
                          {request.reviewNotes && (
                            <span className="block mt-1 text-gray-500">{request.reviewNotes}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
