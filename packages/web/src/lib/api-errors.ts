import { ApiError } from './api-client';

/**
 * Turn a caught error into copy safe to show a user.
 *
 * J-10: `err.message` from the API was being rendered directly into the page
 * in ~15 places (and passed to native `alert()` in two more), including
 * strings like "Role 'buyer' is not permitted. Required: inspector,
 * hub_admin, platform_admin" — an internal role identifier and the server's
 * authorization list, presented as UI copy.
 *
 * This was previously `getLoadErrorMessage`, a one-off in
 * app/(dashboard)/admin/access-requests/page.tsx — the only status-to-copy
 * mapper that existed anywhere in the codebase, and the ONE screen that had
 * it still fell through to the raw `err.message` for anything that wasn't
 * 401/403/429. Promoted here and fixed: an `ApiError`'s raw `message` is
 * never the fallback. Only a non-`ApiError` `Error` (a network exception
 * thrown by our own fetch wrapper, never server text) surfaces its message.
 *
 * `context` is a short present-tense phrase completing "Couldn't ___." —
 * e.g. "load your materials", "cancel this listing". Keep it lowercase with
 * no trailing punctuation.
 */
export function getErrorMessage(err: unknown, context?: string): string {
  const cannot = context ? `Couldn't ${context}.` : 'Something went wrong.';

  if (err instanceof ApiError) {
    // J-02: distinguish "there is nothing here for this account" from an
    // actual failure — checked before the generic status branches because
    // it is more precise than the 400 it rides on.
    if (err.code === 'NO_ORGANISATION') {
      return "This account isn't linked to an organisation, so there's nothing here yet.";
    }
    if (err.status === 429) {
      return 'Too many requests hit the API. Please wait a moment, then retry.';
    }
    if (err.status === 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (err.status === 403) {
      return "You don't have access to this.";
    }
    if (err.status === 404) {
      return context ? `Couldn't find ${context}.` : "That couldn't be found.";
    }
    if (err.status === 0) {
      return "Couldn't reach the TRACE API. Check your connection and try again.";
    }
    // Any other ApiError (400 validation, 409 conflict, 500, …): never the
    // raw server string. `cannot` on its own is deliberately generic here —
    // a caller that needs to surface a specific validation reason should
    // read `err.code` itself rather than pass the message through.
    return cannot;
  }

  return err instanceof Error ? err.message : cannot;
}
