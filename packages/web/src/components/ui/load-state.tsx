import { AlertTriangle, Lock } from 'lucide-react';
import { Card, CardContent } from './card';
import { Button } from './button';

/**
 * J-02 / J-12: two presentational blocks used everywhere a page needs to
 * distinguish "this failed to load" or "you don't have access" from an
 * actual empty state. Extracted because the *copy* needs to be identical at
 * every call site — a card that says "couldn't load" in one place and
 * "failed to fetch" in another is the same inconsistency this batch is
 * fixing, just moved one level up.
 *
 * Not a replacement for every loading/error/empty pattern in the app —
 * `CertificatePanel`'s inline error phase and the full-page
 * `app/passport/[id]/page.tsx` states are deliberately left as they are
 * This covers the
 * dashboard-card shape those two don't.
 */

export function LoadFailure({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card>
      <CardContent className="py-16 text-center space-y-3">
        <AlertTriangle className="mx-auto h-6 w-6 text-gray-400" />
        <p className="text-gray-500 text-sm max-w-sm mx-auto">{message}</p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function NoAccess({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-16 text-center space-y-3">
        <Lock className="mx-auto h-6 w-6 text-gray-400" />
        <p className="text-gray-900 font-medium text-sm">You don&apos;t have access to this.</p>
        <p className="text-gray-500 text-sm max-w-sm mx-auto">{message}</p>
      </CardContent>
    </Card>
  );
}
