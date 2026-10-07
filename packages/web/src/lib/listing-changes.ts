import { formatPrice, formatUkDay, shippingMethodLabel } from './format';

type Change = { from: unknown; to: unknown };

const FIELD_LABELS: Record<string, string> = {
  pricePence: 'Price',
  quantity: 'Quantity',
  minOrderQuantity: 'Minimum order',
  shippingOptions: 'Shipping',
  expiresAt: 'Expiry',
};

function shippingText(value: unknown): string {
  const first = Array.isArray(value)
    ? (value[0] as Record<string, unknown> | undefined)
    : undefined;
  if (!first) return 'none';
  const notes = typeof first['notes'] === 'string' && first['notes'] ? ` (${first['notes']})` : '';
  return `${shippingMethodLabel(String(first['method']))}${notes}`;
}

function valueText(field: string, value: unknown): string {
  if (value === null || value === undefined) return field === 'expiresAt' ? 'no end date' : 'none';
  if (field === 'pricePence' && typeof value === 'number') return formatPrice(value);
  if (field === 'expiresAt') return formatUkDay(String(value));
  if (field === 'shippingOptions') return shippingText(value);
  return String(value);
}

/**
 * A listing edit's audit record in one line: "Price £12.50 → £11.00 ·
 * Quantity 10 → 14". Null when the record carries no changes (older events).
 */
export function listingChangeSummary(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const changes = metadata?.['changes'];
  if (!changes || typeof changes !== 'object') return null;
  const parts = Object.entries(changes as Record<string, Change>)
    .filter(([field]) => field in FIELD_LABELS)
    .map(
      ([field, { from, to }]) =>
        `${FIELD_LABELS[field]} ${valueText(field, from)} → ${valueText(field, to)}`,
    );
  return parts.length > 0 ? parts.join(' · ') : null;
}
