/**
 * What an order's state means to the person looking at it: what happens
 * next and by when, and how it got to where it is. The rules themselves
 * (who may do what, the time limits) live in the API; this is their wording.
 */
import { ORDER_PROBLEM_WINDOW_HOURS, ORDER_RESPONSE_HOURS } from '@trace/core';
import { formatDateTime } from './format';

export interface OrderStep {
  action: string;
  toStatus: string;
  actorSide: string;
  note: string | null;
  createdAt: string;
}

export interface OrderForWording {
  status: string;
  viewerSide?: 'buyer' | 'seller';
  responseDeadline?: string | null;
  disputeDeadline?: string | null;
  steps?: OrderStep[];
}

const SIDE: Record<string, string> = {
  buyer: 'the buyer',
  seller: 'the seller',
  platform: 'the platform',
};

const capitalise = (text: string | undefined) =>
  text ? text.charAt(0).toUpperCase() + text.slice(1) : undefined;

/** One step of an order's history, as a sentence. */
export function stepText(step: OrderStep): string {
  const who = SIDE[step.actorSide] ?? 'someone';
  switch (step.action) {
    case 'placed':
      return `Order placed by ${who}`;
    case 'accept':
      return `Accepted by ${who}`;
    case 'reject':
      return `Rejected by ${who}`;
    case 'cancel':
      return `Cancelled by ${who}`;
    case 'confirm_delivery':
      return `Delivery confirmed by ${who}`;
    case 'flag_dispute':
      return `Problem reported by ${who}`;
    case 'resolve_dispute':
      return step.toStatus === 'cancelled'
        ? 'Resolved by the platform: the order is cancelled'
        : 'Resolved by the platform: the sale stands';
    case 'lapse':
      return `Lapsed: the seller did not answer within ${ORDER_RESPONSE_HOURS} hours`;
    case 'auto_complete':
      return `Completed: the ${ORDER_PROBLEM_WINDOW_HOURS} hours to report a problem passed`;
    default:
      return step.action;
  }
}

/**
 * What happens next on an open order and by when, or how a closed one ended
 * when that is not what its badge alone says. Null when there is nothing to add.
 */
export function orderGuidance(order: OrderForWording): string | null {
  const buyer = order.viewerSide === 'buyer';
  const last = order.steps?.at(-1);

  if (order.status === 'pending') {
    const by = formatDateTime(order.responseDeadline);
    if (!by) return buyer ? 'Waiting for the seller to accept or reject it.' : null;
    return buyer
      ? `The seller has until ${by} to accept or reject it. After that the order lapses.`
      : `Answer by ${by}, or the order lapses and its quantity returns to the lot.`;
  }
  if (order.status === 'confirmed') {
    const by = formatDateTime(order.disputeDeadline);
    if (!by) return buyer ? null : 'The buyer confirms delivery once the material arrives.';
    return buyer
      ? `Confirm delivery when the material arrives, or report a problem by ${by}. After that the order completes by itself.`
      : `The buyer confirms delivery, or the order completes by itself on ${by}.`;
  }
  if (order.status === 'disputed') {
    return 'A problem was reported. The platform team reviews it and decides whether the sale stands.';
  }
  if (last?.action === 'lapse') {
    return `The seller did not answer within ${ORDER_RESPONSE_HOURS} hours, so the order lapsed. Its quantity is back on the marketplace.`;
  }
  if (last?.action === 'auto_complete') {
    return `Completed by itself: nobody reported a problem within ${ORDER_PROBLEM_WINDOW_HOURS} hours of the seller accepting.`;
  }
  // R2: a declined or cancelled order says who closed it, like the others.
  if (last?.action === 'reject') {
    return order.viewerSide === 'seller'
      ? 'You declined this order. Its quantity is back on the marketplace.'
      : 'The seller declined this order.';
  }
  if (last?.action === 'cancel') {
    const by = last.actorSide === order.viewerSide ? 'You' : capitalise(SIDE[last.actorSide]);
    return by ? `${by} cancelled this order.` : null;
  }
  if (last?.action === 'resolve_dispute') {
    return last.toStatus === 'cancelled'
      ? 'The platform resolved the reported problem: the order is cancelled.'
      : 'The platform resolved the reported problem: the sale stands.';
  }
  return null;
}

/** A listing's status in a seller's words; one past its date is expired whatever the sweep has done. */
export function listingStatus(
  listing: { status: string; expiresAt?: string | null },
  now = new Date(),
): string {
  if (
    listing.status === 'active' &&
    listing.expiresAt &&
    new Date(listing.expiresAt).getTime() <= now.getTime()
  ) {
    return 'expired';
  }
  return listing.status;
}
