import {
  Factory,
  Hammer,
  Recycle,
  ShieldCheck,
  Store,
  CheckCircle2,
  PencilLine,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { PassportDetail } from '@/lib/api-client';

/** An append-only amendment to the passport (oldest → newest). */
export interface AmendmentEntry {
  date?: string | null;
}

interface Step {
  icon: LucideIcon;
  title: string;
  detail?: string | undefined;
  date?: string | undefined;
  done: boolean;
}

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : undefined);

/** Honest provenance story built from the passport's own lifecycle data. */
export default function ProvenanceTimeline({
  passport,
  amendments = [],
}: {
  passport: PassportDetail;
  amendments?: AmendmentEntry[];
}) {
  const steps: Step[] = [
    {
      icon: Factory,
      title: 'Manufactured',
      detail:
        [passport.manufacturerName, passport.countryOfOrigin].filter(Boolean).join(' · ') ||
        undefined,
      date: fmt(passport.productionDate),
      done: true,
    },
  ];
  if (passport.deconstructionDate || passport.deconstructionMethod) {
    steps.push({
      icon: Hammer,
      title: 'Deconstructed',
      detail: passport.deconstructionMethod ?? undefined,
      date: fmt(passport.deconstructionDate),
      done: true,
    });
  }
  if (passport.reclaimedBy) {
    steps.push({ icon: Recycle, title: 'Reclaimed', detail: passport.reclaimedBy, done: true });
  }
  steps.push({
    icon: ShieldCheck,
    title: 'Registered on TRACE',
    detail: 'Tamper-evident passport issued (version 1)',
    date: fmt(passport.createdAt),
    done: true,
  });
  // Each edit is an append-only amendment that re-generates the fingerprint.
  amendments.forEach((a, idx) => {
    steps.push({
      icon: PencilLine,
      title: `Amended — version ${idx + 2}`,
      detail: 'Fingerprint re-generated',
      date: fmt(a.date),
      done: true,
    });
  });
  steps.push({
    icon: Store,
    title: 'Listed on the marketplace',
    done: ['listed', 'reserved', 'sold'].includes(passport.status),
  });
  if (passport.status === 'sold') {
    steps.push({ icon: CheckCircle2, title: 'Sold — back in use', done: true });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Provenance</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-5">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="relative flex gap-3 motion-safe:animate-fade-in-up"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              {i < steps.length - 1 && (
                <span
                  className="absolute left-[15px] top-9 -bottom-5 w-px bg-gray-200"
                  aria-hidden
                />
              )}
              <div
                className={cn(
                  'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  s.done ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-400',
                )}
              >
                <s.icon className="h-4 w-4" />
              </div>
              <div className="pt-1">
                <p
                  className={cn('text-sm font-medium', s.done ? 'text-gray-900' : 'text-gray-400')}
                >
                  {s.title}
                </p>
                {s.detail && <p className="text-xs text-gray-500">{s.detail}</p>}
                {s.date && <p className="text-xs text-gray-400">{s.date}</p>}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
