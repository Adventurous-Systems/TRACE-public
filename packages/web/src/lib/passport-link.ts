/**
 * Turn whatever a visitor scanned or pasted into a passport id.
 *
 * Accepts a bare passport id, a passport Digital Link
 * (https://…/passport/<id>, the URL the passport's QR code encodes), or any
 * text containing a passport UUID. The scan page's manual field used to
 * append the whole pasted link to /passport/, producing
 * /passport/http:/…/passport/<id>: a 404 (2026-09-29 rehearsal).
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function passportIdFrom(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  try {
    const segments = new URL(text).pathname.split('/').filter(Boolean);
    const idx = segments.indexOf('passport');
    if (idx !== -1 && segments[idx + 1]) return decodeURIComponent(segments[idx + 1]!);
  } catch {
    // Not a URL; fall through.
  }

  const uuid = text.match(UUID);
  if (uuid) return uuid[0].toLowerCase();
  // A bare, non-UUID id: pass it through (the passport page shows "not found").
  return /^[\w-]+$/.test(text) ? text : null;
}
