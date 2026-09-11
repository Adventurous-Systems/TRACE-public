// Umami analytics — typed, guarded event helper + shared URL sanitiser.
// Self-hosted, cookieless, NO PII. Event names are a dashboard contract
// (funnels/goals match by name) — keep them in sync with UMAMI_PLAYBOOK.md.

export type TraceEvent =
  | 'signup'
  | 'passport-create'
  | 'listing-create'
  | 'marketplace-search'
  | 'access-request'
  | 'make-offer'
  | 'transaction-update';

type EventData = Record<string, string | number | boolean>;

/** Fire a Umami custom event. No-op unless the tracker loaded; never throws into product code. */
export function track(name: TraceEvent, data?: EventData): void {
  try {
    if (typeof window !== 'undefined' && window.umami) {
      window.umami.track(name, data ?? {});
    }
  } catch {
    /* analytics must never break product code */
  }
}

/**
 * Strip high-cardinality identifiers from a path/URL so they never reach Umami:
 * 0x-hex / tx hashes, UUIDs, and long bare-hex path segments become `*`.
 * utm_* query params are preserved so native campaign capture still works.
 * Used by the before-send hook in components/Analytics.tsx.
 */
export function sanitizeUrl(url: string): string {
  if (!url) return url;
  return url
    .replace(/0x[a-fA-F0-9]{6,}/g, '*')
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '*')
    .replace(/\/[0-9a-fA-F]{16,}(?=\/|$|\?)/g, '/*');
}

/** Bucket a price (in pence) into a coarse band — never send a raw amount as an event prop. */
export function priceBand(pence: number): string {
  const pounds = pence / 100;
  if (pounds < 100) return 'lt-100';
  if (pounds < 500) return '100-500';
  if (pounds < 2000) return '500-2000';
  if (pounds < 10000) return '2000-10000';
  return 'gte-10000';
}
