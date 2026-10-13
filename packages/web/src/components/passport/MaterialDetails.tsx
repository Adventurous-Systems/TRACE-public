import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PassportDetail } from '@/lib/api-client';
import { compositionRows, dimensionsLine, specRows } from '@/lib/passport-details';

/**
 * What the material is made of, its size and its specifications. Held on
 * every curated passport, and returned by the API, but shown by no page
 * until the 2026-10-13 journey audit. Nothing when none of it is recorded.
 */
export function MaterialDetails({
  passport,
  declaredLine,
}: {
  passport: Pick<PassportDetail, 'materialComposition' | 'dimensions' | 'technicalSpecs'>;
  declaredLine: string;
}) {
  const composition = compositionRows(passport.materialComposition);
  const size = dimensionsLine(passport.dimensions);
  const specs = specRows(passport.technicalSpecs);
  if (composition.length === 0 && !size && specs.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Material and specifications</CardTitle>
        <p className="text-xs text-gray-500">{declaredLine}</p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {composition.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
              Composition
            </h3>
            <ul aria-label="Composition" className="space-y-1">
              {composition.map((part) => (
                <li key={part.material} className="flex justify-between gap-4">
                  <span>
                    {part.material}
                    {part.recycled && <span className="ml-2 text-xs text-green-700">recycled</span>}
                  </span>
                  {part.share && <span className="font-medium">{part.share}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(size || specs.length > 0) && (
          <dl className="space-y-2">
            {size && (
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Dimensions</dt>
                <dd className="text-right font-medium">{size}</dd>
              </div>
            )}
            {specs.map((row) => (
              <div key={row.label} className="flex justify-between gap-4">
                <dt className="text-gray-500">{row.label}</dt>
                <dd className="text-right font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
