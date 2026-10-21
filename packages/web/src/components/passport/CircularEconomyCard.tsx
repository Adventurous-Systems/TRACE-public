import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { circularRows, reuseLabel, type CircularFields } from '@/lib/passport-details';

/**
 * Where the material comes from and how it can be reused. "No circular data
 * recorded" only when there is none: it used to show under a remaining-life
 * value, because it looked at two fields only.
 */
export function CircularEconomyCard({
  passport,
  declaredLine,
}: {
  passport: CircularFields;
  declaredLine: string;
}) {
  const rows = circularRows(passport);
  const reuse = (passport.reuseSuitability ?? []).filter((value) => value.trim());
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Circular economy</CardTitle>
        <p className="text-xs text-gray-500">{declaredLine}</p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {rows.length > 0 && (
          <dl className="space-y-2">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-gray-500">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {reuse.length > 0 && (
          <div>
            <p className="text-gray-500">Suitable for reuse in</p>
            <ul aria-label="Suitable for reuse in" className="mt-1 flex flex-wrap gap-1.5">
              {reuse.map((value) => (
                <li key={value} className="rounded-full border bg-gray-50 px-2.5 py-0.5 text-xs">
                  {reuseLabel(value)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {rows.length === 0 && reuse.length === 0 && (
          <p className="text-xs text-gray-400">No circular data recorded</p>
        )}
      </CardContent>
    </Card>
  );
}
