/**
 * The buyer-side rules for how much of a lot one order may take. They mirror
 * makeOffer in the API, which enforces them; these only give early feedback.
 */
export interface LotAvailability {
  quantityAvailable: number;
  minOrderQuantity: number;
  /** Less than quantityAvailable when the demo keeps a curated lot's last unit. */
  orderableQuantity?: number;
}

/** The most one order may take. */
export function orderableOf(lot: LotAvailability): number {
  return Math.min(lot.orderableQuantity ?? lot.quantityAvailable, lot.quantityAvailable);
}

/** Whether the demo holds back this lot's last unit. */
export function keepsLastUnit(lot: LotAvailability): boolean {
  return orderableOf(lot) < lot.quantityAvailable;
}

/** What the quantity field starts at: the minimum order, or all that may be ordered. */
export function defaultOrderQuantity(lot: LotAvailability): number {
  return Math.max(1, Math.min(lot.minOrderQuantity, orderableOf(lot)));
}

/** Why this quantity can't be ordered, or null when it can. */
export function orderQuantityProblem(quantity: number, lot: LotAvailability): string | null {
  if (!Number.isInteger(quantity) || quantity < 1) return 'Enter a whole number of at least 1.';
  const orderable = orderableOf(lot);
  if (quantity > orderable) {
    return keepsLastUnit(lot)
      ? `On the demo the last one stays on the marketplace: you can order up to ${orderable.toLocaleString('en-GB')}.`
      : `Only ${lot.quantityAvailable.toLocaleString('en-GB')} left.`;
  }
  // Below the minimum only when that is everything that may be ordered.
  if (quantity < lot.minOrderQuantity && quantity < orderable) {
    return `The minimum order is ${lot.minOrderQuantity.toLocaleString('en-GB')}.`;
  }
  return null;
}
