import { Compass } from 'lucide-react';
import { Card } from '@/components/ui/card';

const STEPS = [
  'Browse the marketplace below — every listing is synthetic reclaimed material.',
  "Open a listing, then its passport, and click “Verify integrity” — it recomputes the material's fingerprint live and shows whether it matches.",
  'Create a free account with a fictitious email — no verification, no real password needed.',
  'Make an offer at asking price and track it under Orders.',
];

/**
 * Static "what to try" panel for the public buyer demo only. No tour
 * library, no dismiss-and-remember state (that would need somewhere to
 * persist it per viewer) — just a few concrete steps, open by default so a
 * first-time visitor actually sees them, and collapsible via <details> for
 * anyone who wants it out of the way.
 */
export function DemoGuide() {
  return (
    <div className="trace-public-buyer-demo-only">
      <Card className="p-4">
        <details open>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-gray-900 marker:content-none">
            <Compass className="h-4 w-4 text-brand-600" aria-hidden="true" />
            What to try in this demo
          </summary>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-gray-600">
            {STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </details>
      </Card>
    </div>
  );
}
