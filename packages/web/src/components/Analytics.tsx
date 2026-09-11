'use client';

import { useEffect } from 'react';
import { sanitizeUrl } from '@/lib/analytics';

// Self-hosted Umami tracker (privacy-friendly, cookieless), loaded same-origin via
// the nginx /stats/ proxy. The website id comes from the server layout (which reads
// the runtime env var UMAMI_WEBSITE_ID and passes it as a prop — NEXT_PUBLIC_* would
// be build-time-inlined and never reach the client bundle). Gated by env (primary)
// and the hostname allow-list below (failsafe), so localhost/preview stay silent.
const TRACKED_HOSTS = ['trace.adventurous.systems', 'trace-staging.adventurous.systems'];

export function Analytics({ websiteId }: { websiteId: string }) {
  useEffect(() => {
    if (!TRACKED_HOSTS.includes(window.location.hostname)) return;
    if (document.getElementById('umami-tracker')) return; // guard double-mount

    // The before-send hook must exist before the tracker initialises. It strips
    // high-cardinality ids/hashes from the URL (and same-origin referrer) so no
    // UUID/tx-hash ever leaves the browser; utm_* query params are preserved.
    window.__umamiBeforeSend = (_type, payload) => {
      try {
        if (payload?.url) payload.url = sanitizeUrl(payload.url);
        if (payload?.referrer && payload.referrer.indexOf(location.origin) === 0) {
          payload.referrer =
            location.origin + sanitizeUrl(payload.referrer.slice(location.origin.length));
        }
      } catch {
        /* never break tracking */
      }
      return payload;
    };

    const s = document.createElement('script');
    s.id = 'umami-tracker';
    s.src = '/stats/script.js';
    s.defer = true;
    s.setAttribute('data-website-id', websiteId);
    s.setAttribute('data-before-send', '__umamiBeforeSend');
    document.head.appendChild(s);
  }, [websiteId]);

  return null;
}
