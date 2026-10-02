/**
 * Data invariants of the marketplace: what must always be true of listings,
 * orders and passports, whatever sequence of actions produced them.
 *
 * Pure rules over plain rows, so they can be tested with crafted data and run
 * read-only against any environment (check-invariants.ts). An `error` is data
 * the application should never produce; a `warning` is worth a human look
 * (none are raised today).
 */

/** Orders that still hold part of a lot (mirrors the API's open statuses). */
export const OPEN_ORDER_STATUSES = ['pending', 'confirmed', 'disputed'] as const;
/** Orders whose quantity is no longer available: held, or sold. */
export const TAKING_ORDER_STATUSES = [...OPEN_ORDER_STATUSES, 'completed', 'resolved'] as const;

export interface ListingRow {
  id: string;
  passportId: string;
  status: string;
  quantity: number;
  quantityAvailable: number;
  minOrderQuantity: number;
}

export interface OrderRow {
  id: string;
  listingId: string;
  status: string;
  quantity: number;
  amountPence: number;
  disputeDeadline: Date | null;
  /** Placed before part-of-a-lot ordering: whole lot, one unit's price. */
  legacyWholeLot: boolean;
}

export interface PassportRow {
  id: string;
  productName: string;
  status: string;
  /** The stored fingerprint, or null while an anchor is pending. */
  storedHash: string | null;
  /** The fingerprint recomputed from the row as it is now. */
  computedHash: string;
}

export interface Violation {
  severity: 'error' | 'warning';
  rule: string;
  /** The row it is about: "listing <id>", "order <id>", "passport <name>". */
  subject: string;
  detail: string;
}

/** The passport status each live listing status implies. */
const PASSPORT_STATUS_FOR_LISTING: Record<string, readonly string[]> = {
  active: ['listed'],
  reserved: ['reserved'],
  // A sold material carries on through its life after the sale.
  sold: ['sold', 'installed', 'decommissioned'],
};

const isOpen = (order: OrderRow) =>
  (OPEN_ORDER_STATUSES as readonly string[]).includes(order.status);
const takes = (order: OrderRow) =>
  (TAKING_ORDER_STATUSES as readonly string[]).includes(order.status);

export function checkInvariants(data: {
  listings: ListingRow[];
  orders: OrderRow[];
  passports: PassportRow[];
}): Violation[] {
  const violations: Violation[] = [];
  const add = (severity: Violation['severity'], rule: string, subject: string, detail: string) =>
    violations.push({ severity, rule, subject, detail });

  const ordersByListing = new Map<string, OrderRow[]>();
  for (const order of data.orders) {
    ordersByListing.set(order.listingId, [...(ordersByListing.get(order.listingId) ?? []), order]);
  }
  const passportById = new Map(data.passports.map((p) => [p.id, p]));
  const listingById = new Map(data.listings.map((l) => [l.id, l]));
  const liveListingsByPassport = new Map<string, ListingRow[]>();

  for (const listing of data.listings) {
    const subject = `listing ${listing.id}`;
    const orders = ordersByListing.get(listing.id) ?? [];
    const open = orders.filter(isOpen);
    const taken = orders.filter(takes).reduce((sum, order) => sum + order.quantity, 0);

    if (listing.quantityAvailable < 0 || listing.quantityAvailable > listing.quantity) {
      add(
        'error',
        'stock-range',
        subject,
        `available ${listing.quantityAvailable} is outside 0..${listing.quantity}`,
      );
    }
    if (listing.quantityAvailable !== listing.quantity - taken) {
      add(
        'error',
        'stock-sum',
        subject,
        `available ${listing.quantityAvailable}, but the lot of ${listing.quantity} has ${taken} taken by orders`,
      );
    }
    if (listing.minOrderQuantity < 1 || listing.minOrderQuantity > listing.quantity) {
      add(
        'error',
        'minimum-order',
        subject,
        `minimum order ${listing.minOrderQuantity} is outside 1..${listing.quantity}`,
      );
    }

    if (listing.status === 'active' && listing.quantityAvailable === 0) {
      add('error', 'status-stock', subject, 'active with nothing available');
    }
    if (listing.status === 'reserved' && (listing.quantityAvailable !== 0 || open.length === 0)) {
      add(
        'error',
        'status-stock',
        subject,
        `reserved with ${listing.quantityAvailable} available and ${open.length} open order(s)`,
      );
    }
    if (listing.status === 'sold' && (listing.quantityAvailable !== 0 || open.length > 0)) {
      add(
        'error',
        'status-stock',
        subject,
        `sold with ${listing.quantityAvailable} available and ${open.length} open order(s)`,
      );
    }
    if (['cancelled', 'expired'].includes(listing.status) && open.length > 0) {
      add(
        'error',
        'stranded-order',
        subject,
        `${listing.status} with ${open.length} open order(s)`,
      );
    }

    const expected = PASSPORT_STATUS_FOR_LISTING[listing.status];
    if (expected) {
      liveListingsByPassport.set(listing.passportId, [
        ...(liveListingsByPassport.get(listing.passportId) ?? []),
        listing,
      ]);
      const passport = passportById.get(listing.passportId);
      if (passport && !expected.includes(passport.status)) {
        add(
          'error',
          'passport-status',
          subject,
          `${listing.status}, but its passport "${passport.productName}" is ${passport.status}`,
        );
      }
    }
  }

  for (const [passportId, live] of liveListingsByPassport) {
    if (live.length > 1) {
      const name = passportById.get(passportId)?.productName ?? passportId;
      add(
        'error',
        'one-live-listing',
        `passport ${name}`,
        `${live.length} live listings (${live.map((l) => l.status).join(', ')})`,
      );
    }
  }

  for (const order of data.orders) {
    const subject = `order ${order.id}`;
    if (!listingById.has(order.listingId)) {
      add('error', 'orphan-order', subject, `its listing ${order.listingId} does not exist`);
    }
    if (order.quantity < 1) add('error', 'order-quantity', subject, `quantity ${order.quantity}`);
    if (order.amountPence < 1) add('error', 'order-amount', subject, `amount ${order.amountPence}`);
    if (
      ['confirmed', 'disputed', 'resolved', 'completed'].includes(order.status) &&
      !order.disputeDeadline
    ) {
      add('error', 'dispute-window', subject, `${order.status} without a dispute deadline`);
    }
    // An order placed before part-of-a-lot ordering took the whole lot for one
    // unit's price and had a dispute deadline from the start; that is what
    // legacyWholeLot records. Any other order must fit the current model.
    if (!order.legacyWholeLot) {
      if (order.status === 'pending' && order.disputeDeadline) {
        add('error', 'dispute-window', subject, 'pending with a dispute deadline');
      }
      if (order.quantity > 0 && order.amountPence % order.quantity !== 0) {
        add(
          'error',
          'order-amount',
          subject,
          `amount ${order.amountPence}p is not a unit price × quantity ${order.quantity}`,
        );
      }
    }
  }

  for (const passport of data.passports) {
    if (passport.storedHash && passport.storedHash !== passport.computedHash) {
      add(
        'error',
        'stale-fingerprint',
        `passport ${passport.productName}`,
        'its stored fingerprint no longer matches its data (verify-integrity would fail)',
      );
    }
  }

  return violations;
}
