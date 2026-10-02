import { eq, and, or, inArray, ilike, gte, lte, desc, asc, sql, type SQL } from 'drizzle-orm';
import {
  db,
  listings,
  transactions,
  materialPassports,
  passportEvents,
  organisations,
  type Listing,
  type Transaction,
} from '@trace/db';
import {
  type CreateListingInput,
  type UpdateListingInput,
  type MakeOfferInput,
  type MarketplaceQueryInput,
  type UpdateTransactionInput,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
  MAX_AMOUNT_PENCE,
} from '@trace/core';
import { SEED_TAG } from '@trace/core/constants/demo-catalogue';

/** Orders that still hold part of a lot: not yet completed, resolved or cancelled. */
const OPEN_TRANSACTION_STATUSES = ['pending', 'confirmed', 'disputed'] as const;

/**
 * The active-listing predicate every public browse surface shares
 * (searchListings, getMarketplaceStats, and the facets endpoint added
 * alongside it). curatedOnly additionally requires the curated demo tag, so
 * a public_buyer_demo visitor's own listings never appear in anonymous
 * browse — see docs/operations/public-buyer-demo.md. Kept in one place so
 * browse and its facets can never independently drift out of sync.
 */
function browseConditions(curatedOnly: boolean): SQL[] {
  const conditions = [eq(listings.status, 'active')];
  if (curatedOnly) {
    conditions.push(sql`${materialPassports.customAttributes}->>'seedSource' = ${SEED_TAG}`);
  }
  return conditions;
}

// ─── Listing: Create ─────────────────────────────────────────────────────────

export async function createListing(
  input: CreateListingInput,
  sellerId: string,
  organisationId: string,
): Promise<Listing> {
  // Verify passport exists and belongs to seller's org
  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, input.passportId),
  });

  if (!passport) throw new NotFoundError('Passport', input.passportId);
  if (passport.organisationId !== organisationId) {
    throw new ForbiddenError('Passport does not belong to your organisation');
  }
  if (
    passport.status === 'listed' ||
    passport.status === 'reserved' ||
    passport.status === 'sold'
  ) {
    throw new ConflictError('Passport is already listed or sold');
  }
  if (passport.status === 'decommissioned') {
    throw new ConflictError('Decommissioned materials cannot be listed');
  }
  // A material must have at least one photo before it can be listed for sale.
  const photos = (passport.conditionPhotos ?? []) as string[];
  if (photos.length === 0) {
    throw new ConflictError(
      'At least one material photo is required before listing this material.',
    );
  }

  const [listing] = await db
    .insert(listings)
    .values({
      passportId: input.passportId,
      organisationId,
      sellerId,
      pricePence: input.pricePence,
      currency: input.currency,
      quantity: input.quantity,
      quantityAvailable: input.quantity,
      minOrderQuantity: input.minOrderQuantity,
      shippingOptions: input.shippingOptions as Array<{
        method: string;
        deliveryRadiusMiles?: number;
        deliveryCostPence?: number;
        notes?: string;
      }>,
      status: 'active',
      expiresAt: input.expiresAt ?? null,
    })
    .returning();

  if (!listing) throw new Error('Failed to insert listing');

  // Update passport status to listed
  await db
    .update(materialPassports)
    .set({ status: 'listed', updatedAt: new Date() })
    .where(eq(materialPassports.id, input.passportId));

  // EPCIS event
  await db.insert(passportEvents).values({
    passportId: input.passportId,
    eventType: 'ObjectEvent',
    eventData: {
      action: 'OBSERVE',
      bizStep: 'urn:epcglobal:cbv:bizstep:offering_for_sale',
      disposition: 'urn:epcglobal:cbv:disp:sellable_accessible',
      listingId: listing.id,
    },
    actorId: sellerId,
  });

  return listing;
}

// ─── Listing: Read ───────────────────────────────────────────────────────────

export interface ListingWithPassport extends Listing {
  passport: {
    productName: string;
    categoryL1: string;
    categoryL2: string | null;
    unitOfMeasure: string | null;
    conditionGrade: string | null;
    conditionNotes: string | null;
    carbonSavingsVsNew: string | null;
    qrCodeUrl: string | null;
    photo?: string | null;
  };
  organisation: {
    name: string;
    slug: string;
  };
}

export async function getListingById(listingId: string): Promise<ListingWithPassport> {
  const listing = await db.query.listings.findFirst({
    where: eq(listings.id, listingId),
    with: {
      passport: {
        columns: {
          productName: true,
          categoryL1: true,
          categoryL2: true,
          unitOfMeasure: true,
          conditionGrade: true,
          conditionNotes: true,
          carbonSavingsVsNew: true,
          qrCodeUrl: true,
          conditionPhotos: true,
        },
      },
      organisation: {
        columns: { name: true, slug: true },
      },
    },
  });

  if (!listing) throw new NotFoundError('Listing', listingId);

  // Same shape as searchListings: the first condition photo as `photo`, so
  // the listing page can show the product (it showed none before).
  const { conditionPhotos, ...passport } = listing.passport;
  return {
    ...listing,
    passport: { ...passport, photo: (conditionPhotos as string[] | null)?.[0] ?? null },
  } as unknown as ListingWithPassport;
}

export async function searchListings(
  query: MarketplaceQueryInput,
  options: { curatedOnly?: boolean } = {},
): Promise<{ data: ListingWithPassport[]; total: number; page: number; limit: number }> {
  // All filters pushed into SQL — no in-memory post-filtering
  const conditions = browseConditions(options.curatedOnly ?? false);

  if (query.minPricePence !== undefined)
    conditions.push(gte(listings.pricePence, query.minPricePence));
  if (query.maxPricePence !== undefined)
    conditions.push(lte(listings.pricePence, query.maxPricePence));
  if (query.categoryL1) conditions.push(eq(materialPassports.categoryL1, query.categoryL1));
  if (query.categoryL2) conditions.push(eq(materialPassports.categoryL2, query.categoryL2));
  if (query.conditionGrade)
    conditions.push(eq(materialPassports.conditionGrade, query.conditionGrade));
  if (query.hubSlug) conditions.push(eq(organisations.slug, query.hubSlug));
  if (query.q) {
    const pattern = `%${query.q}%`;
    conditions.push(
      or(
        ilike(materialPassports.productName, pattern),
        ilike(materialPassports.categoryL1, pattern),
        ilike(materialPassports.conditionNotes, pattern),
      )!,
    );
  }

  const where = and(...conditions);
  const offset = (query.page - 1) * query.limit;

  const sortColMap = {
    createdAt: listings.createdAt,
    pricePence: listings.pricePence,
    carbonSavingsVsNew: materialPassports.carbonSavingsVsNew,
  } as const;
  const sortCol = sortColMap[query.sortBy] ?? listings.createdAt;
  const orderFn = query.sortOrder === 'asc' ? asc : desc;

  const baseQuery = db
    .select({
      // All listing columns
      id: listings.id,
      passportId: listings.passportId,
      organisationId: listings.organisationId,
      sellerId: listings.sellerId,
      pricePence: listings.pricePence,
      currency: listings.currency,
      quantity: listings.quantity,
      quantityAvailable: listings.quantityAvailable,
      minOrderQuantity: listings.minOrderQuantity,
      shippingOptions: listings.shippingOptions,
      status: listings.status,
      blockchainTxHash: listings.blockchainTxHash,
      expiresAt: listings.expiresAt,
      createdAt: listings.createdAt,
      // Passport fields
      passportProductName: materialPassports.productName,
      passportCategoryL1: materialPassports.categoryL1,
      passportCategoryL2: materialPassports.categoryL2,
      passportUnitOfMeasure: materialPassports.unitOfMeasure,
      passportConditionGrade: materialPassports.conditionGrade,
      passportConditionNotes: materialPassports.conditionNotes,
      passportCarbonSavingsVsNew: materialPassports.carbonSavingsVsNew,
      passportQrCodeUrl: materialPassports.qrCodeUrl,
      passportPhotos: materialPassports.conditionPhotos,
      // Organisation fields
      orgName: organisations.name,
      orgSlug: organisations.slug,
    })
    .from(listings)
    .innerJoin(materialPassports, eq(listings.passportId, materialPassports.id))
    .innerJoin(organisations, eq(listings.organisationId, organisations.id));

  const [rows, countResult] = await Promise.all([
    baseQuery.where(where).orderBy(orderFn(sortCol)).limit(query.limit).offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(listings)
      .innerJoin(materialPassports, eq(listings.passportId, materialPassports.id))
      .innerJoin(organisations, eq(listings.organisationId, organisations.id))
      .where(where),
  ]);

  const data: ListingWithPassport[] = rows.map((row) => ({
    id: row.id,
    passportId: row.passportId,
    organisationId: row.organisationId,
    sellerId: row.sellerId,
    pricePence: row.pricePence,
    currency: row.currency,
    quantity: row.quantity,
    quantityAvailable: row.quantityAvailable,
    minOrderQuantity: row.minOrderQuantity,
    shippingOptions: row.shippingOptions,
    status: row.status,
    blockchainTxHash: row.blockchainTxHash,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    passport: {
      productName: row.passportProductName,
      categoryL1: row.passportCategoryL1,
      categoryL2: row.passportCategoryL2,
      unitOfMeasure: row.passportUnitOfMeasure,
      conditionGrade: row.passportConditionGrade,
      conditionNotes: row.passportConditionNotes,
      carbonSavingsVsNew: row.passportCarbonSavingsVsNew,
      qrCodeUrl: row.passportQrCodeUrl,
      photo: (row.passportPhotos as string[] | null)?.[0] ?? null,
    },
    organisation: {
      name: row.orgName,
      slug: row.orgSlug,
    },
  }));

  return {
    data,
    total: countResult[0]?.count ?? 0,
    page: query.page,
    limit: query.limit,
  };
}

/**
 * totalCarbonSavedKg: what reusing everything still on offer would save
 * against new materials, i.e. each passport's per-unit saving times the
 * quantity still available (finding 3: it used to add per-unit figures).
 */
export async function getMarketplaceStats(options: { curatedOnly?: boolean } = {}): Promise<{
  totalCarbonSavedKg: number;
  activeCount: number;
}> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(cast(${materialPassports.carbonSavingsVsNew} as double precision) * ${listings.quantityAvailable}), 0)`,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(listings)
    .innerJoin(materialPassports, eq(listings.passportId, materialPassports.id))
    .where(and(...browseConditions(options.curatedOnly ?? false)));
  return { totalCarbonSavedKg: Math.round(Number(row?.total ?? 0)), activeCount: row?.count ?? 0 };
}

/**
 * The category and condition-grade values browse can actually return, given
 * the same browseConditions() the listings and stats endpoints use. Lets the
 * marketplace filter UI hide options that would only ever return zero
 * results — most visibly on the demo, where the full category/grade lists
 * are far wider than the curated catalogue's four categories and two grades.
 */
export async function getMarketplaceFacets(
  options: { curatedOnly?: boolean } = {},
): Promise<{ categoryL1: string[]; conditionGrade: string[] }> {
  const where = and(...browseConditions(options.curatedOnly ?? false));

  const [categoryRows, gradeRows] = await Promise.all([
    db
      .selectDistinct({ categoryL1: materialPassports.categoryL1 })
      .from(listings)
      .innerJoin(materialPassports, eq(listings.passportId, materialPassports.id))
      .where(where),
    db
      .selectDistinct({ conditionGrade: materialPassports.conditionGrade })
      .from(listings)
      .innerJoin(materialPassports, eq(listings.passportId, materialPassports.id))
      .where(where),
  ]);

  return {
    categoryL1: categoryRows.map((r) => r.categoryL1).sort(),
    conditionGrade: gradeRows
      .map((r) => r.conditionGrade)
      .filter((g): g is string => g !== null)
      .sort(),
  };
}

export async function listHubListings(organisationId: string): Promise<ListingWithPassport[]> {
  const data = await db.query.listings.findMany({
    where: eq(listings.organisationId, organisationId),
    orderBy: [desc(listings.createdAt)],
    with: {
      passport: {
        columns: {
          productName: true,
          categoryL1: true,
          categoryL2: true,
          unitOfMeasure: true,
          conditionGrade: true,
          conditionNotes: true,
          carbonSavingsVsNew: true,
          qrCodeUrl: true,
        },
      },
      organisation: {
        columns: { name: true, slug: true },
      },
    },
  });

  return data as unknown as ListingWithPassport[];
}

// ─── A lot's status ──────────────────────────────────────────────────────────

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * A lot's status follows from its stock and its open orders, and nothing else:
 * on the marketplace while anything is left, reserved while everything is held
 * by an order still in progress, sold once nothing is left and nothing is open.
 */
export function lotStatus(
  quantityAvailable: number,
  openOrders: number,
): 'active' | 'reserved' | 'sold' {
  if (quantityAvailable > 0) return 'active';
  return openOrders > 0 ? 'reserved' : 'sold';
}

/** The passport status each live lot status implies. */
const PASSPORT_STATUS_FOR_LOT = { active: 'listed', reserved: 'reserved', sold: 'sold' } as const;

/**
 * Write a lot's stock and let its status, and its passport's, follow. Every
 * path that changes stock or an order's state ends here, inside its own DB
 * transaction and after its order rows are written, so the three can never
 * disagree. The caller holds the listing's row lock.
 */
async function settleLot(
  tx: DbTx,
  listing: Pick<Listing, 'id' | 'passportId' | 'status'>,
  quantityAvailable: number,
  changes: Partial<Listing> = {},
): Promise<Listing> {
  const [open] = await tx
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.listingId, listing.id),
        inArray(transactions.status, [...OPEN_TRANSACTION_STATUSES]),
      ),
    );
  // A cancelled or expired listing keeps its status; only its stock is kept true.
  const live = ['active', 'reserved', 'sold'].includes(listing.status);
  const status = live ? lotStatus(quantityAvailable, open?.count ?? 0) : listing.status;

  const [updated] = await tx
    .update(listings)
    .set({ ...changes, quantityAvailable, status })
    .where(eq(listings.id, listing.id))
    .returning();
  if (!updated) throw new Error('Listing update failed');

  if (live && status !== listing.status) {
    await tx
      .update(materialPassports)
      .set({
        status: PASSPORT_STATUS_FOR_LOT[status as keyof typeof PASSPORT_STATUS_FOR_LOT],
        updatedAt: new Date(),
      })
      .where(eq(materialPassports.id, listing.passportId));
  }
  return updated;
}

// ─── Listing: Update / Cancel ────────────────────────────────────────────────

export async function updateListing(
  listingId: string,
  input: UpdateListingInput,
  organisationId: string,
): Promise<Listing> {
  const listing = await db.query.listings.findFirst({
    where: eq(listings.id, listingId),
  });

  if (!listing) throw new NotFoundError('Listing', listingId);
  if (listing.organisationId !== organisationId) {
    throw new ForbiddenError('Listing does not belong to your organisation');
  }
  if (listing.status !== 'active') {
    throw new ConflictError(`Cannot update listing with status '${listing.status}'`);
  }

  return db.transaction(async (tx) => {
    // Lock the row so an offer can't take stock between the check and the write.
    const [current] = await tx
      .select()
      .from(listings)
      .where(eq(listings.id, listingId))
      .for('update');
    if (!current || current.status !== 'active') {
      throw new ConflictError(
        `Cannot update listing with status '${current?.status ?? 'missing'}'`,
      );
    }

    const changes: Partial<Listing> = {};
    let quantityAvailable = current.quantityAvailable;
    if (input.pricePence !== undefined) changes.pricePence = input.pricePence;
    if (input.quantity !== undefined) {
      // Orders already placed keep their share of the lot.
      const committed = current.quantity - current.quantityAvailable;
      if (input.quantity < committed) {
        throw new ConflictError(
          `Orders already hold ${committed} of this lot, so the quantity cannot go below that`,
        );
      }
      changes.quantity = input.quantity;
      quantityAvailable = input.quantity - committed;
    }
    if (input.minOrderQuantity !== undefined) {
      if (input.minOrderQuantity > (changes.quantity ?? current.quantity)) {
        throw new ValidationError('The minimum order cannot be more than the quantity listed');
      }
      changes.minOrderQuantity = input.minOrderQuantity;
    }
    if (input.shippingOptions !== undefined) {
      changes.shippingOptions = input.shippingOptions as Listing['shippingOptions'];
    }
    if (input.expiresAt !== undefined) changes.expiresAt = input.expiresAt;

    // Shrinking a lot to what is ordered reserves it; to what is sold, sells it.
    return settleLot(tx, current, quantityAvailable, changes);
  });
}

export async function cancelListing(listingId: string, organisationId: string): Promise<Listing> {
  const listing = await db.query.listings.findFirst({
    where: eq(listings.id, listingId),
  });

  if (!listing) throw new NotFoundError('Listing', listingId);
  if (listing.organisationId !== organisationId) {
    throw new ForbiddenError('Listing does not belong to your organisation');
  }
  if (!['active', 'reserved'].includes(listing.status)) {
    throw new ConflictError(`Cannot cancel listing with status '${listing.status}'`);
  }
  const [open] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.listingId, listingId),
        inArray(transactions.status, [...OPEN_TRANSACTION_STATUSES]),
      ),
    );
  if ((open?.count ?? 0) > 0) {
    throw new ConflictError(
      `This listing has ${open!.count} open order(s); accept, reject or cancel them first`,
    );
  }

  const [cancelled] = await db
    .update(listings)
    .set({ status: 'cancelled' })
    .where(eq(listings.id, listingId))
    .returning();

  if (!cancelled) throw new Error('Cancel failed');

  // Revert passport status to active
  await db
    .update(materialPassports)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(materialPassports.id, listing.passportId));

  return cancelled;
}

// ─── Who is looking at an order ──────────────────────────────────────────────

/** The signed-in user, as far as orders are concerned. */
export interface Viewer {
  userId: string;
  role: string;
  organisationId?: string | null;
}

/** Roles that sell on behalf of their organisation. */
const SELLER_ROLES = ['hub_admin', 'hub_staff', 'supplier'];

/**
 * A hub's orders belong to the hub, not to whichever member created the
 * listing: any of its selling staff may see and answer them (owner decision,
 * 2026-10-02). The user who created the listing always counts.
 */
function sellsFor(
  viewer: Viewer,
  order: Pick<Transaction, 'sellerId'>,
  listing: Pick<Listing, 'organisationId'>,
): boolean {
  if (order.sellerId === viewer.userId) return true;
  return (
    !!viewer.organisationId &&
    viewer.organisationId === listing.organisationId &&
    SELLER_ROLES.includes(viewer.role)
  );
}

// ─── Transaction: Make Offer ─────────────────────────────────────────────────

/**
 * Order part (or all) of a lot at the asking price. The order holds its
 * quantity until it is completed, resolved or cancelled; the listing stays on
 * the marketplace while anything is left, and is reserved once every unit is
 * held.
 */
export async function makeOffer(input: MakeOfferInput, buyer: Viewer): Promise<Transaction> {
  return db.transaction(async (tx) => {
    // Lock the listing: concurrent offers on one lot queue here, so between
    // them buyers can never take more than is available.
    const [listing] = await tx
      .select()
      .from(listings)
      .where(eq(listings.id, input.listingId))
      .for('update');

    if (!listing) throw new NotFoundError('Listing', input.listingId);
    if (listing.status !== 'active') {
      throw new ConflictError(`Listing is not available (status: ${listing.status})`);
    }
    if (
      listing.sellerId === buyer.userId ||
      (buyer.organisationId && buyer.organisationId === listing.organisationId)
    ) {
      throw new ForbiddenError("You can't order from your own organisation's listing");
    }
    if (listing.expiresAt && listing.expiresAt < new Date()) {
      throw new ConflictError('Listing has expired');
    }

    const available = listing.quantityAvailable;
    const quantity = input.quantity ?? Math.min(listing.minOrderQuantity, available);
    if (quantity > available) {
      throw new ConflictError(
        `Only ${available} of this lot ${available === 1 ? 'is' : 'are'} left`,
      );
    }
    // Below the minimum only when that is everything that's left.
    if (quantity < listing.minOrderQuantity && quantity < available) {
      throw new ValidationError(`The minimum order for this lot is ${listing.minOrderQuantity}`);
    }
    const amountPence = listing.pricePence * quantity;
    if (amountPence > MAX_AMOUNT_PENCE) {
      throw new ValidationError(
        `This order's total is more than the platform can process in one order ` +
          `(£${(MAX_AMOUNT_PENCE / 100).toLocaleString('en-GB')}); order a smaller quantity`,
      );
    }

    const [transaction] = await tx
      .insert(transactions)
      .values({
        listingId: listing.id,
        buyerId: buyer.userId,
        sellerId: listing.sellerId,
        quantity,
        amountPence,
        status: 'pending',
        // The dispute window opens when the seller accepts.
        disputeDeadline: null,
        notes: input.notes ?? null,
      })
      .returning();

    if (!transaction) throw new Error('Failed to create transaction');

    await settleLot(tx, listing, available - quantity);
    return transaction;
  });
}

// ─── Transaction: Update Status ──────────────────────────────────────────────

const DISPUTE_WINDOW_MS = 48 * 60 * 60 * 1000;

type OrderAction = UpdateTransactionInput['action'];
type OrderSide = 'buyer' | 'seller' | 'party' | 'platform_admin';

/**
 * The order steps:
 *
 *   pending   --seller accepts-->           confirmed
 *   pending   --seller rejects-->           cancelled  (quantity returned)
 *   pending   --buyer or seller cancels-->  cancelled  (quantity returned)
 *   confirmed --buyer confirms delivery-->  completed  (sale final)
 *   confirmed --buyer flags a problem-->    disputed
 *   confirmed --buyer or seller cancels-->  cancelled  (quantity returned)
 *   disputed  --platform admin resolves-->  resolved   (the sale stands)
 *
 * "Seller" is anyone who sells for the lot's organisation (see sellsFor). A
 * buyer can't confirm delivery of an order the seller hasn't accepted.
 */
const TRANSITIONS: Record<OrderAction, { from: readonly string[]; to: string; by: OrderSide }> = {
  accept: { from: ['pending'], to: 'confirmed', by: 'seller' },
  reject: { from: ['pending'], to: 'cancelled', by: 'seller' },
  cancel: { from: ['pending', 'confirmed'], to: 'cancelled', by: 'party' },
  confirm_delivery: { from: ['confirmed'], to: 'completed', by: 'buyer' },
  flag_dispute: { from: ['confirmed'], to: 'disputed', by: 'buyer' },
  resolve_dispute: { from: ['disputed'], to: 'resolved', by: 'platform_admin' },
};

const ACTION_WORDING: Record<OrderAction, string> = {
  accept: 'accept',
  reject: 'reject',
  cancel: 'cancel',
  confirm_delivery: 'confirm delivery of',
  flag_dispute: 'flag a problem with',
  resolve_dispute: 'resolve',
};

function mayAct(side: OrderSide, on: { buyer: boolean; seller: boolean; admin: boolean }): boolean {
  return (
    (side === 'buyer' && on.buyer) ||
    (side === 'seller' && on.seller) ||
    (side === 'party' && (on.buyer || on.seller)) ||
    (side === 'platform_admin' && on.admin)
  );
}

/**
 * What this viewer can do to this order right now. The web shows exactly
 * these, so the order steps are written down once, here.
 */
function allowedActions(
  order: Pick<Transaction, 'status'>,
  on: { buyer: boolean; seller: boolean; admin: boolean },
): OrderAction[] {
  return (Object.keys(TRANSITIONS) as OrderAction[]).filter((action) => {
    const step = TRANSITIONS[action];
    return step.from.includes(order.status) && mayAct(step.by, on);
  });
}

export async function updateTransaction(
  transactionId: string,
  input: UpdateTransactionInput,
  viewer: Viewer,
): Promise<Transaction> {
  const step = TRANSITIONS[input.action];
  if (!step) throw new ConflictError('Unknown action');

  return db.transaction(async (dbTx) => {
    const [order] = await dbTx
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .for('update');
    if (!order) throw new NotFoundError('Order', transactionId);

    const [listing] = await dbTx
      .select()
      .from(listings)
      .where(eq(listings.id, order.listingId))
      .for('update');
    if (!listing) throw new NotFoundError('Listing', order.listingId);

    // No dispute-resolution governance exists yet (no arbiter role, no CBT/DAO
    // voting) — platform_admin is the interim authority. Revisit when governance
    // lands; keep this ownership check aligned with the route authorization.
    const on = {
      buyer: order.buyerId === viewer.userId,
      seller: sellsFor(viewer, order, listing),
      admin: viewer.role === 'platform_admin',
    };
    if (!mayAct(step.by, on)) {
      const who = {
        buyer: 'the buyer',
        seller: 'the seller',
        party: 'the buyer or the seller',
        platform_admin: 'a platform administrator',
      }[step.by];
      throw new ForbiddenError(`Only ${who} can ${ACTION_WORDING[input.action]} this order`);
    }
    if (!step.from.includes(order.status)) {
      const hint =
        order.status === 'pending' && input.action === 'confirm_delivery'
          ? ' — the seller has not accepted it yet'
          : '';
      throw new ConflictError(
        `Cannot ${ACTION_WORDING[input.action]} an order that is ${order.status}${hint}`,
      );
    }

    const updateSet: Partial<Transaction> = { status: step.to };
    if (input.notes) updateSet.notes = input.notes;
    if (step.to === 'confirmed') {
      updateSet.disputeDeadline = new Date(Date.now() + DISPUTE_WINDOW_MS);
    }
    const [updated] = await dbTx
      .update(transactions)
      .set(updateSet)
      .where(and(eq(transactions.id, transactionId), eq(transactions.status, order.status)))
      .returning();
    if (!updated) {
      throw new ConflictError('The order changed while this was being saved; try again');
    }

    // A cancelled order gives its share back; then the lot's status follows.
    const returned = step.to === 'cancelled' ? order.quantity : 0;
    await settleLot(
      dbTx,
      listing,
      Math.min(listing.quantity, listing.quantityAvailable + returned),
    );

    if (step.to === 'completed' || step.to === 'resolved') {
      // EPCIS transfer event
      await dbTx.insert(passportEvents).values({
        passportId: listing.passportId,
        eventType: 'TransactionEvent',
        eventData: {
          action: 'ADD',
          bizStep: 'urn:epcglobal:cbv:bizstep:selling',
          disposition: 'urn:epcglobal:cbv:disp:sold',
          transactionId,
          buyerId: order.buyerId,
          quantity: order.quantity,
          amountPence: order.amountPence,
        },
        actorId: viewer.userId,
      });
    }

    return updated;
  });
}

// ─── Transaction: Read ───────────────────────────────────────────────────────

export async function getTransactionById(
  transactionId: string,
  viewer: Viewer,
): Promise<Transaction> {
  const found = await db.query.transactions.findFirst({
    where: eq(transactions.id, transactionId),
    with: { listing: { columns: { organisationId: true } } },
  });
  if (!found) throw new NotFoundError('Order', transactionId);
  const { listing, ...order } = found;

  // Object-level scope: the buyer, the selling organisation's staff, or a
  // platform admin. 404 rather than 403 for everyone else — same pattern as
  // getPassportById's draft scoping — so an unrelated account can't even
  // confirm the id exists.
  const isParty =
    order.buyerId === viewer.userId || (listing !== null && sellsFor(viewer, order, listing));
  if (!isParty && viewer.role !== 'platform_admin') {
    throw new NotFoundError('Order', transactionId);
  }

  return order;
}

export type OrderForViewer = Transaction & {
  productName: string | null;
  passportId: string | null;
  unitOfMeasure: string | null;
  /** Which side of the order the viewer is on. */
  viewerSide: 'buyer' | 'seller';
  /** The order steps the viewer may take now. */
  allowedActions: OrderAction[];
};

/** The viewer's orders: those they placed, and those their organisation sells. */
export async function listUserTransactions(viewer: Viewer): Promise<OrderForViewer[]> {
  // Plain names inside the subquery: the relational query builder re-aliases
  // any column object it is given to the root table.
  const sellsForOrganisation =
    viewer.organisationId && SELLER_ROLES.includes(viewer.role)
      ? sql`${transactions.listingId} in (select id from listings where organisation_id = ${viewer.organisationId})`
      : sql`false`;
  const data = await db.query.transactions.findMany({
    where: or(
      eq(transactions.buyerId, viewer.userId),
      eq(transactions.sellerId, viewer.userId),
      sellsForOrganisation,
    ),
    orderBy: [desc(transactions.createdAt)],
    with: {
      listing: {
        columns: { passportId: true, organisationId: true },
        with: { passport: { columns: { productName: true, unitOfMeasure: true } } },
      },
    },
  });
  return data.map(({ listing, ...order }) => {
    const buyer = order.buyerId === viewer.userId;
    const seller = listing !== null && sellsFor(viewer, order, listing);
    return {
      ...order,
      passportId: listing?.passportId ?? null,
      productName: listing?.passport?.productName ?? null,
      unitOfMeasure: listing?.passport?.unitOfMeasure ?? null,
      viewerSide: buyer ? 'buyer' : 'seller',
      allowedActions: allowedActions(order, {
        buyer,
        seller,
        admin: viewer.role === 'platform_admin',
      }),
    };
  });
}
