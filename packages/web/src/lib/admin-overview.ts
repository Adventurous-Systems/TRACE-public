/**
 * What the platform admin's dashboard says about each thing that may wait
 * for them. Its dashboard said only "This account isn't linked to an
 * organisation" (journey audit, 2026-10-13).
 */
import type { FeedbackEntry } from './api-client';
import { formatDate } from './format';

/** "2 orders wait for a decision", "Nothing waiting". */
export function waitingLine(count: number, one: string, many: string): string {
  if (count === 0) return 'Nothing waiting';
  return `${count} ${count === 1 ? one : many}`;
}

/** "5 submissions, the latest on 3 Oct 2026". */
export function feedbackLine(entries: Pick<FeedbackEntry, 'createdAt'>[]): string {
  if (entries.length === 0) return 'No feedback yet';
  const latest = entries
    .map((e) => e.createdAt)
    .sort()
    .at(-1)!;
  return `${entries.length} ${entries.length === 1 ? 'submission' : 'submissions'}, the latest on ${formatDate(latest)}`;
}

/** The anchoring account's VTHO balance, in words; unknown is never "ok". */
export function gasPayerLine(status: string | null | undefined): {
  text: string;
  tone: 'ok' | 'warn' | 'unknown';
} {
  if (status === 'ok') return { text: 'Gas payer balance is healthy', tone: 'ok' };
  if (status === 'warning' || status === 'critical') {
    return { text: `Gas payer balance is ${status}: top it up`, tone: 'warn' };
  }
  return { text: 'Gas payer balance unknown', tone: 'unknown' };
}
