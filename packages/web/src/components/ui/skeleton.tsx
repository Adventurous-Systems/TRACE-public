import { cn } from '@/lib/utils';

/** Shimmering placeholder for loading states. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-md bg-gray-100', className)}>
      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/70 to-transparent motion-safe:animate-shimmer" />
    </div>
  );
}
