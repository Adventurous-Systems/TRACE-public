/**
 * The buyer-side rules for how much of a lot one order may take. They mirror
 * makeOffer in the API, which enforces them; these only give early feedback.
 */
export interface LotAvailability {
  quantityAvailable: number;
  minOrderQuantity: number;
}

/** What the quantity field starts at: the minimum order, or all that's left. */
export function defaultOrderQuantity(lot: LotAvailability): number {
  return Math.max(1, Math.min(lot.minOrderQuantity, lot.quantityAvailable));
}

/** Why this quantity can't be ordered, or null when it can. */
export function orderQuantityProblem(quantity: number, lot: LotAvailability): string | null {
  if (!Number.isInteger(quantity) || quantity < 1) return 'Enter a whole number of at least 1.';
  if (quantity > lot.quantityAvailable) {
    return `Only ${lot.quantityAvailable.toLocaleString('en-GB')} left.`;
  }
  // Below the minimum only when that is everything that's left.
  if (quantity < lot.minOrderQuantity && quantity < lot.quantityAvailable) {
    return `The minimum order is ${lot.minOrderQuantity.toLocaleString('en-GB')}.`;
  }
  return null;
}
