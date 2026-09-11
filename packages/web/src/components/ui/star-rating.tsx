/**
 * J-06: replaces `StarDisplay` in app/(dashboard)/admin/feedback/page.tsx.
 *
 * The bug wasn't that the component ignored the rating — it read it
 * correctly. It rendered the FILLED glyph ('★') for both halves, the empty
 * one merely recoloured to `text-gray-200` (#e5e7eb) at `text-sm` on a white
 * card — indistinguishable in practice, so every rating painted as five
 * stars. A 4-star entry and a 5-star entry were visually identical even
 * though the page's own computed average (4.5) was correct.
 *
 * Fixed with a different glyph for the empty half ('☆'), which reads
 * correctly in high contrast mode, print, and copy-paste — not just at this
 * one opacity. Also fixes two latent bugs found alongside it: `rating` was
 * never clamped, so a value outside 1–5 threw `RangeError` from
 * `'★'.repeat(negative)`; and there was no accessible name at all, so a
 * screen reader announced five identical "★" glyphs regardless of rating.
 *
 * Deliberately NOT merged with FeedbackWidget's rating *input* — that one is
 * five separate <button>s with hover state and click handlers; this is
 * read-only display. Merging them would mean a `mode` prop gating unrelated
 * behaviour for a single shared consumer on each side.
 */
export function StarRating({ rating, className }: { rating: number; className?: string }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span
      role="img"
      aria-label={`${filled} out of 5 stars`}
      className={className ?? 'text-yellow-400 text-sm'}
    >
      {'★'.repeat(filled)}
      <span className="text-gray-300">{'☆'.repeat(5 - filled)}</span>
    </span>
  );
}
