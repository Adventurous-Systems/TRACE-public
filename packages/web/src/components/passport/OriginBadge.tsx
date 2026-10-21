import { cn } from '@/lib/utils';
import { originLabel } from '@/lib/passport-details';

// Dark text on a pale tint: readable, and distinct from the grade and trust badges.
const TONES: Record<string, string> = {
  reclaimed: 'border-green-200 bg-green-50 text-green-800',
  surplus: 'border-amber-200 bg-amber-50 text-amber-900',
  new: 'border-sky-200 bg-sky-50 text-sky-900',
};

/**
 * Where the material comes from: reclaimed, surplus, or a new circular
 * product. Declared by the seller; nothing when the seller has not said.
 */
export function OriginBadge({
  origin,
  className,
}: {
  origin: string | null | undefined;
  className?: string;
}) {
  const label = originLabel(origin);
  if (!label) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONES[origin!],
        className,
      )}
    >
      {label}
    </span>
  );
}
