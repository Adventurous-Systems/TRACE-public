import { eq, and, or, inArray, ilike, gte, lte, desc, asc, sql, type SQL } from 'drizzle-orm';
import {
  db,
  listings,
  transactions,
  orderEvents,
  users,
  materialPassports,
  passportEvents,
  organisations,
  type Listing,
  type Transaction,
  type OrderEvent,
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
  TraceError,
  ValidationError,
  MAX_AMOUNT_PENCE,
  ORDER_RESPONSE_HOURS,
  ORDER_PROBLEM_WINDOW_HOURS,
} from '@trace/core';
import { SEED_TAG } from '@trace/core/constants/demo-catalogue';

/** Lots a seller can still edit: on sale, fully ordered, or expired with stock (D1, D3). */
const EDITABLE_LOT_STATUSES = ['active', 'reserved', 'expired'];

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
  const conditions: SQL[] = [
    eq(listings.status, 'active'),
    // Past its date, a listing is off the marketplace at once; the sweep
    // marks it expired afterwards.
    sql`(${listings.expiresAt} is null or ${listings.expiresAt} > now())`,
  ];
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
  /** How much one order may take now; see orderableQuantity. */
  orderableQuantity?: number;
}

/**
 * On the public demo a curated lot keeps its last unit (owner, 2026-10-06):
 * nobody answers a visitor's order there, so a visitor who ordered a whole
 * lot used to take the product off the demo marketplace for the 72 hours
 * the order stays open. Everywhere else, and for anyone's own lots, all that
 * is left can be ordered.
 */
export function orderableQuantity(
  listing: { quantityAvailable: number },
  passport: { customAttributes: unknown },
  options: { keepLastCuratedUnit?: boolean } = {},
): number {
  const curated =
    (passport.customAttributes as Record<string, unknown> | null)?.['seedSource'] === SEED_TAG;
  return options.keepLastCuratedUnit && curated
    ? Math.max(0, listing.quantityAvailable - 1)
    : listing.quantityAvailable;
}

/**
 * A listing past its date reads as expired at once (R1). The sweep marks it
 * expired only when no order is open on it, which can take days; until then
 * the row still says active, and the listing page offered an order the API
 * refuses. Applied when a listing is read; the row itself is left to the sweep.
 */
export function listingStatusAt(
  listing: { status: string; expiresAt: Date | null },
  now: Date = new Date(),
): string {
  return listing.status === 'active' && listing.expiresAt && listing.expiresAt <= now
    ? 'expired'
    : listing.status;
}

export async function getListingById(
  listingId: string,
  options: { keepLastCuratedUnit?: boolean } = {},
): Promise<ListingWithPassport> {
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
          customAttributes: true,
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
  const { conditionPhotos, customAttributes, ...passport } = listing.passport;
  return {
    ...listing,
    status: listingStatusAt(listing),
    orderableQuantity: orderableQuantity(listing, { customAttributes }, options),
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

  return data.map((listing) => ({
    ...listing,
    status: listingStatusAt(listing),
  })) as unknown as ListingWithPassport[];
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
  options: { reopen?: boolean } = {},
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
  // A cancelled or expired listing keeps its status; only its stock is kept
  // true. Reopening an expired one (the seller gave it a new date) makes it live.
  const reopen = options.reopen === true;
  const live = reopen || ['active', 'reserved', 'sold'].includes(listing.status);
  const status = live ? lotStatus(quantityAvailable, open?.count ?? 0) : listing.status;

  const [updated] = await tx
    .update(listings)
    .set({ ...changes, quantityAvailable, status })
    .where(eq(listings.id, listing.id))
    .returning();
  if (!updated) throw new Error('Listing update failed');

  if (live && (reopen || status !== listing.status)) {
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

/** The listing fields a seller can change, as the audit record names them. */
const EDITABLE_FIELDS = [
  'pricePence',
  'quantity',
  'minOrderQuantity',
  'shippingOptions',
  'expiresAt',
] as const;

export type ListingChanges = Partial<
  Record<(typeof EDITABLE_FIELDS)[number], { from: unknown; to: unknown }>
>;

function comparable(value: unknown): string {
  return JSON.stringify(value instanceof Date ? value.toISOString() : (value ?? null));
}

/** What an edit changed, field by field, before and after. */
function listingChanges(before: Listing, after: Listing): ListingChanges {
  const changed: ListingChanges = {};
  for (const field of EDITABLE_FIELDS) {
    if (comparable(before[field]) !== comparable(after[field])) {
      changed[field] = { from: before[field] ?? null, to: after[field] ?? null };
    }
  }
  return changed;
}

/**
 * A seller edits their own lot: price, quantity, minimum order, shipping and
 * expiry. A lot on sale or fully ordered can change (D1). An expired lot can
 * go back on sale with a new date or none, while it has stock and its
 * material hasn't been listed again since (D3). A sold or cancelled lot stays
 * closed (D2): new stock is a new listing.
 */
export async function updateListing(
  listingId: string,
  input: UpdateListingInput,
  organisationId: string,
  now = new Date(),
): Promise<{ listing: Listing; changes: ListingChanges }> {
  const listing = await db.query.listings.findFirst({
    where: eq(listings.id, listingId),
  });

  if (!listing) throw new NotFoundError('Listing', listingId);
  if (listing.organisationId !== organisationId) {
    throw new ForbiddenError('Listing does not belong to your organisation');
  }

  return db.transaction(async (tx) => {
    // Lock the row so an offer can't take stock between the check and the write.
    const [current] = await tx
      .select()
      .from(listings)
      .where(eq(listings.id, listingId))
      .for('update');
    if (!current) throw new NotFoundError('Listing', listingId);
    if (current.status === 'sold') {
      throw new ConflictError(
        'This lot is sold and can no longer be changed. List new stock as a new listing.',
      );
    }
    if (!EDITABLE_LOT_STATUSES.includes(current.status)) {
      throw new ConflictError(`Cannot update listing with status '${current.status}'`);
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
    // null clears the date: the lot no longer expires.
    if (input.expiresAt !== undefined) changes.expiresAt = input.expiresAt;

    // An expired lot only goes back on sale; an edit that leaves it expired
    // would change nothing anyone can see.
    const reopen = current.status === 'expired';
    if (reopen) {
      const expiresAt = changes.expiresAt !== undefined ? changes.expiresAt : current.expiresAt;
      if (expiresAt && expiresAt <= now) {
        throw new ConflictError(
          'This listing has expired. Give it a new date, or clear the date, to put it back on sale.',
        );
      }
      if (quantityAvailable < 1) {
        throw new ConflictError('Nothing is left of this lot to put back on sale');
      }
      // When the listing expired its material became free to list again.
      const [passport] = await tx
        .select({ status: materialPassports.status })
        .from(materialPassports)
        .where(eq(materialPassports.id, current.passportId))
        .for('update');
      if (passport?.status === 'decommissioned') {
        throw new ConflictError('Decommissioned materials cannot be listed');
      }
      if (passport?.status !== 'active') {
        throw new TraceError(
          'This material has been listed again since this listing expired. Edit that listing instead.',
          'MATERIAL_RELISTED',
          409,
        );
      }
    }

    // Shrinking a lot to what is ordered reserves it; to what is sold, sells it.
    const updated = await settleLot(tx, current, quantityAvailable, changes, { reopen });
    return { listing: updated, changes: listingChanges(current, updated) };
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
export async function makeOffer(
  input: MakeOfferInput,
  buyer: Viewer,
  options: { keepLastCuratedUnit?: boolean } = {},
): Promise<Transaction> {
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

    const [passport] = await tx
      .select({ customAttributes: materialPassports.customAttributes })
      .from(materialPassports)
      .where(eq(materialPassports.id, listing.passportId));
    const available = listing.quantityAvailable;
    const orderable = orderableQuantity(listing, passport ?? { customAttributes: null }, options);
    if (orderable < available && orderable < 1) {
      throw new ConflictError(
        'This is the last one of this lot, and on the demo it stays on the marketplace',
      );
    }
    const quantity = input.quantity ?? Math.min(listing.minOrderQuantity, orderable);
    if (orderable < available && quantity > orderable) {
      throw new ConflictError(
        `On the demo the last one of a lot stays on the marketplace: you can order up to ${orderable}`,
      );
    }
    if (quantity > available) {
      throw new ConflictError(
        `Only ${available} of this lot ${available === 1 ? 'is' : 'are'} left`,
      );
    }
    // Below the minimum only when that is everything that may be ordered.
    if (quantity < listing.minOrderQuantity && quantity < orderable) {
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
        responseDeadline: new Date(Date.now() + RESPONSE_WINDOW_MS),
        notes: input.notes ?? null,
      })
      .returning();

    if (!transaction) throw new Error('Failed to create transaction');

    await tx.insert(orderEvents).values({
      transactionId: transaction.id,
      action: 'placed',
      fromStatus: null,
      toStatus: 'pending',
      actorId: buyer.userId,
      actorSide: 'buyer',
      note: input.notes ?? null,
    });
    await settleLot(tx, listing, available - quantity);
    return transaction;
  });
}

// ─── Transaction: the order steps ────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const RESPONSE_WINDOW_MS = ORDER_RESPONSE_HOURS * HOUR_MS;
const DISPUTE_WINDOW_MS = ORDER_PROBLEM_WINDOW_HOURS * HOUR_MS;

type OrderAction = UpdateTransactionInput['action'];
type OrderSide = 'buyer' | 'seller' | 'party' | 'platform_admin';
/** Who took a step, as the other side reads it. */
type ActorSide = 'buyer' | 'seller' | 'platform' | 'time_limit';
/** Steps nobody asks for: a time limit takes them. */
type TimedAction = 'lapse' | 'auto_complete';

/**
 * The order steps:
 *
 *   pending   --seller accepts-->           confirmed
 *   pending   --seller rejects-->           cancelled  (quantity returned)
 *   pending   --buyer or seller cancels-->  cancelled  (quantity returned)
 *   pending   --72 hours unanswered-->      cancelled  (quantity returned)
 *   confirmed --buyer confirms delivery-->  completed  (sale final)
 *   confirmed --buyer flags a problem-->    disputed   (with a reason)
 *   confirmed --buyer or seller cancels-->  cancelled  (quantity returned)
 *   confirmed --problem window closes-->    completed  (sale final)
 *   disputed  --platform admin resolves-->  resolved   (the sale stands)
 *                                      or   cancelled  (quantity returned)
 *
 * "Seller" is anyone who sells for the lot's organisation (see sellsFor). A
 * buyer can't confirm delivery of an order the seller hasn't accepted. The
 * time limits are the owner's decisions of 2026-10-02.
 */
const TRANSITIONS: Record<OrderAction, { from: readonly string[]; to: string; by: OrderSide }> = {
  accept: { from: ['pending'], to: 'confirmed', by: 'seller' },
  reject: { from: ['pending'], to: 'cancelled', by: 'seller' },
  cancel: { from: ['pending', 'confirmed'], to: 'cancelled', by: 'party' },
  confirm_delivery: { from: ['confirmed'], to: 'completed', by: 'buyer' },
  flag_dispute: { from: ['confirmed'], to: 'disputed', by: 'buyer' },
  // "to" is the outcome "the sale stands"; "cancel the order" ends cancelled.
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

/** Why an order a time limit closed can no longer be acted on. */
const TIMED_OUT: Record<TimedAction, string> = {
  lapse: `The seller did not answer within ${ORDER_RESPONSE_HOURS} hours, so this order lapsed and its quantity went back to the lot`,
  auto_complete: `This order completed when the ${ORDER_PROBLEM_WINDOW_HOURS} hours to report a problem ran out`,
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

/** When an unanswered order lapses. An order the previous release placed has no date of its own. */
export function responseDeadlineOf(
  order: Pick<Transaction, 'responseDeadline' | 'createdAt'>,
): Date {
  return order.responseDeadline ?? new Date(order.createdAt.getTime() + RESPONSE_WINDOW_MS);
}

/** The step a time limit takes on this order at `now`, if any. */
function timedStep(
  order: Pick<Transaction, 'status' | 'responseDeadline' | 'createdAt' | 'disputeDeadline'>,
  now: Date,
): { action: TimedAction; to: string } | null {
  if (order.status === 'pending' && responseDeadlineOf(order) <= now) {
    return { action: 'lapse', to: 'cancelled' };
  }
  if (order.status === 'confirmed' && order.disputeDeadline && order.disputeDeadline <= now) {
    return { action: 'auto_complete', to: 'completed' };
  }
  return null;
}

/**
 * Move an order one step: its status, the lot's stock and status, the
 * passport's history, and the record of the step. The caller holds the row
 * locks on the order and its listing, and has checked the step is allowed.
 */
async function applyStep(
  dbTx: DbTx,
  order: Transaction,
  listing: Listing,
  step: {
    action: OrderAction | TimedAction;
    to: string;
    actorId: string | null;
    actorSide: ActorSide;
    note: string | null;
    now: Date;
  },
): Promise<Transaction> {
  const updateSet: Partial<Transaction> = { status: step.to };
  if (step.to === 'confirmed') {
    updateSet.disputeDeadline = new Date(step.now.getTime() + DISPUTE_WINDOW_MS);
  }
  const [updated] = await dbTx
    .update(transactions)
    .set(updateSet)
    .where(and(eq(transactions.id, order.id), eq(transactions.status, order.status)))
    .returning();
  if (!updated) {
    throw new ConflictError('The order changed while this was being saved; try again');
  }

  // A cancelled order gives its share back; then the lot's status follows.
  const returned = step.to === 'cancelled' ? order.quantity : 0;
  await settleLot(dbTx, listing, Math.min(listing.quantity, listing.quantityAvailable + returned));

  if (step.to === 'completed' || step.to === 'resolved') {
    // EPCIS transfer event
    await dbTx.insert(passportEvents).values({
      passportId: listing.passportId,
      eventType: 'TransactionEvent',
      eventData: {
        action: 'ADD',
        bizStep: 'urn:epcglobal:cbv:bizstep:selling',
        disposition: 'urn:epcglobal:cbv:disp:sold',
        transactionId: order.id,
        buyerId: order.buyerId,
        quantity: order.quantity,
        amountPence: order.amountPence,
      },
      actorId: step.actorId,
    });
  }

  await dbTx.insert(orderEvents).values({
    transactionId: order.id,
    action: step.action,
    fromStatus: order.status,
    toStatus: step.to,
    actorId: step.actorId,
    actorSide: step.actorSide,
    note: step.note,
    createdAt: step.now,
  });
  return updated;
}

/**
 * If a time limit has passed on this order, take its step now. The sweep does
 * this for every order; a person's action does it first for theirs, so nobody
 * acts on an order that should already have closed.
 */
async function closeIfOverdue(transactionId: string, now: Date): Promise<TimedAction | null> {
  return db.transaction(async (dbTx) => {
    const [order] = await dbTx
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .for('update');
    const due = order && timedStep(order, now);
    if (!order || !due) return null;
    const [listing] = await dbTx
      .select()
      .from(listings)
      .where(eq(listings.id, order.listingId))
      .for('update');
    if (!listing) return null;
    await applyStep(dbTx, order, listing, {
      ...due,
      actorId: null,
      actorSide: 'time_limit',
      note: null,
      now,
    });
    return due.action;
  });
}

/** Orders a time limit has passed on, as a query condition. */
function overdueAt(now: Date): SQL {
  return or(
    and(
      eq(transactions.status, 'pending'),
      // A raw fragment gets no column type, so the date goes in as text.
      sql`coalesce(${transactions.responseDeadline}, ${transactions.createdAt} + make_interval(hours => ${ORDER_RESPONSE_HOURS})) <= ${now.toISOString()}::timestamptz`,
    ),
    and(eq(transactions.status, 'confirmed'), lte(transactions.disputeDeadline, now)),
  )!;
}

/**
 * Close every order whose time limit has passed, and expire listings past
 * their date. Run by the worker every minute, and before orders are listed
 * so a late sweep never shows a stale state. Safe to run concurrently: each
 * order is re-checked under its row lock.
 */
export async function sweepOrderLifecycle(
  now = new Date(),
): Promise<{ lapsed: number; completed: number; expiredListings: number }> {
  const result = { lapsed: 0, completed: 0, expiredListings: 0 };

  const due = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(overdueAt(now))
    .limit(500);
  for (const { id } of due) {
    const taken = await closeIfOverdue(id, now);
    if (taken === 'lapse') result.lapsed += 1;
    if (taken === 'auto_complete') result.completed += 1;
  }

  // A listing past its date leaves the marketplace. One with open orders
  // waits for them: an order must not be stranded on an expired listing.
  const stale = await db
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.status, 'active'), lte(listings.expiresAt, now)))
    .limit(500);
  for (const { id } of stale) {
    const expired = await db.transaction(async (dbTx) => {
      const [listing] = await dbTx.select().from(listings).where(eq(listings.id, id)).for('update');
      if (!listing || listing.status !== 'active') return false;
      if (!listing.expiresAt || listing.expiresAt > now) return false;
      const [open] = await dbTx
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(transactions)
        .where(
          and(
            eq(transactions.listingId, id),
            inArray(transactions.status, [...OPEN_TRANSACTION_STATUSES]),
          ),
        );
      if ((open?.count ?? 0) > 0) return false;
      await dbTx.update(listings).set({ status: 'expired' }).where(eq(listings.id, id));
      // As when a seller cancels a listing: the material can be listed again.
      await dbTx
        .update(materialPassports)
        .set({ status: 'active', updatedAt: now })
        .where(eq(materialPassports.id, listing.passportId));
      return true;
    });
    if (expired) result.expiredListings += 1;
  }
  return result;
}

export async function updateTransaction(
  transactionId: string,
  input: UpdateTransactionInput,
  viewer: Viewer,
  now = new Date(),
): Promise<Transaction> {
  const step = TRANSITIONS[input.action];
  if (!step) throw new ConflictError('Unknown action');

  // A time limit that has passed takes its step before anyone else's.
  const timedOut = await closeIfOverdue(transactionId, now);

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

    // The platform admin resolves a flagged order (owner decision,
    // 2026-10-02): the hub is often the seller. Revisit with the governance
    // model; keep this check aligned with the route authorization.
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
      if (timedOut) throw new ConflictError(TIMED_OUT[timedOut]);
      const hint =
        order.status === 'pending' && input.action === 'confirm_delivery'
          ? ' — the seller has not accepted it yet'
          : '';
      throw new ConflictError(
        `Cannot ${ACTION_WORDING[input.action]} an order that is ${order.status}${hint}`,
      );
    }

    const to =
      input.action === 'resolve_dispute' && input.outcome === 'cancel_order'
        ? 'cancelled'
        : step.to;
    return applyStep(dbTx, order, listing, {
      action: input.action,
      to,
      actorId: viewer.userId,
      actorSide:
        on.admin && step.by === 'platform_admin' ? 'platform' : on.buyer ? 'buyer' : 'seller',
      note: input.notes || null,
      now,
    });
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

/** One step of an order, as its parties may read it: no user ids. */
export interface OrderStep {
  action: string;
  toStatus: string;
  actorSide: string;
  note: string | null;
  createdAt: Date;
}

const toStep = (event: OrderEvent): OrderStep => ({
  action: event.action,
  toStatus: event.toStatus,
  actorSide: event.actorSide,
  note: event.note,
  createdAt: event.createdAt,
});

export type OrderForViewer = Transaction & {
  productName: string | null;
  passportId: string | null;
  unitOfMeasure: string | null;
  /** Which side of the order the viewer is on. */
  viewerSide: 'buyer' | 'seller';
  /** The order steps the viewer may take now. */
  allowedActions: OrderAction[];
  /** How the order got to where it is, oldest first. */
  steps: OrderStep[];
  /** Someone else moved it since the viewer last opened their orders. */
  isNew: boolean;
  /** The viewer is the one it is waiting for. */
  needsViewer: boolean;
};

/** The viewer's orders: those they placed, and those their organisation sells. */
export async function listUserTransactions(
  viewer: Viewer,
  now = new Date(),
): Promise<OrderForViewer[]> {
  // Plain names inside the subquery: the relational query builder re-aliases
  // any column object it is given to the root table.
  const sellsForOrganisation =
    viewer.organisationId && SELLER_ROLES.includes(viewer.role)
      ? sql`${transactions.listingId} in (select id from listings where organisation_id = ${viewer.organisationId})`
      : sql`false`;
  const mine = or(
    eq(transactions.buyerId, viewer.userId),
    eq(transactions.sellerId, viewer.userId),
    sellsForOrganisation,
  )!;

  // Time limits that have passed take their step before the list is read, so
  // it never shows an order the sweep has yet to reach as still open.
  const overdue = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(mine, overdueAt(now)));
  for (const { id } of overdue) await closeIfOverdue(id, now);

  const [data, [me]] = await Promise.all([
    db.query.transactions.findMany({
      where: mine,
      orderBy: [desc(transactions.createdAt)],
      with: {
        events: { orderBy: [asc(orderEvents.createdAt)] },
        listing: {
          columns: { passportId: true, organisationId: true },
          with: { passport: { columns: { productName: true, unitOfMeasure: true } } },
        },
      },
    }),
    db.select({ seenAt: users.ordersSeenAt }).from(users).where(eq(users.id, viewer.userId)),
  ]);
  const seenAt = me?.seenAt ?? null;

  return data.map(({ listing, events, ...order }) => {
    const buyer = order.buyerId === viewer.userId;
    const seller = listing !== null && sellsFor(viewer, order, listing);
    const last = events.at(-1);
    return {
      ...order,
      responseDeadline: order.status === 'pending' ? responseDeadlineOf(order) : null,
      passportId: listing?.passportId ?? null,
      productName: listing?.passport?.productName ?? null,
      unitOfMeasure: listing?.passport?.unitOfMeasure ?? null,
      viewerSide: buyer ? 'buyer' : 'seller',
      allowedActions: allowedActions(order, {
        buyer,
        seller,
        admin: viewer.role === 'platform_admin',
      }),
      steps: events.map(toStep),
      isNew: !!last && last.actorId !== viewer.userId && (!seenAt || last.createdAt > seenAt),
      needsViewer:
        (order.status === 'pending' && seller && !buyer) || (order.status === 'confirmed' && buyer),
    };
  });
}

/**
 * What the "Orders" link should say: how many orders wait for this person,
 * and how many someone else moved since they last looked. For a platform
 * admin, flagged orders wait for them too.
 */
export async function getOrdersSummary(
  viewer: Viewer,
): Promise<{ needsAction: number; changed: number; flagged: number }> {
  const orders = await listUserTransactions(viewer);
  let flagged = 0;
  if (viewer.role === 'platform_admin') {
    const [row] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(transactions)
      .where(eq(transactions.status, 'disputed'));
    flagged = row?.count ?? 0;
  }
  return {
    needsAction: orders.filter((order) => order.needsViewer).length,
    changed: orders.filter((order) => order.isNew).length,
    flagged,
  };
}

/** The viewer has opened their orders: what is there now is no longer new. */
export async function markOrdersSeen(viewer: Viewer, now = new Date()): Promise<void> {
  await db.update(users).set({ ordersSeenAt: now }).where(eq(users.id, viewer.userId));
}

// ─── Flagged orders: the platform admin's list ───────────────────────────────

export interface FlaggedOrder {
  id: string;
  status: string;
  quantity: number;
  amountPence: number;
  createdAt: Date;
  productName: string | null;
  passportId: string | null;
  unitOfMeasure: string | null;
  buyer: { name: string; email: string } | null;
  sellerOrganisation: string | null;
  /** When the buyer flagged it, and what they said; null on older flags. */
  flaggedAt: Date | null;
  reason: string | null;
  /** How it was resolved, once it has been. */
  resolution: { outcome: 'sale_stands' | 'cancel_order'; note: string | null; at: Date } | null;
  steps: OrderStep[];
}

/**
 * Orders with a problem flagged, waiting first, then those already resolved.
 * For the platform admin, who resolves them (owner decision, 2026-10-02).
 */
export async function listFlaggedOrders(): Promise<FlaggedOrder[]> {
  const data = await db.query.transactions.findMany({
    where: or(
      eq(transactions.status, 'disputed'),
      sql`${transactions.id} in (select transaction_id from order_events where action = 'resolve_dispute')`,
    ),
    orderBy: [desc(transactions.createdAt)],
    limit: 200,
    with: {
      events: { orderBy: [asc(orderEvents.createdAt)] },
      buyer: { columns: { name: true, email: true } },
      listing: {
        columns: { passportId: true },
        with: {
          passport: { columns: { productName: true, unitOfMeasure: true } },
          organisation: { columns: { name: true } },
        },
      },
    },
  });

  const orders = data.map(({ listing, events, buyer, ...order }): FlaggedOrder => {
    const latest = (action: string) => [...events].reverse().find((e) => e.action === action);
    const flag = latest('flag_dispute');
    const resolved = latest('resolve_dispute');
    return {
      id: order.id,
      status: order.status,
      quantity: order.quantity,
      amountPence: order.amountPence,
      createdAt: order.createdAt,
      productName: listing?.passport?.productName ?? null,
      passportId: listing?.passportId ?? null,
      unitOfMeasure: listing?.passport?.unitOfMeasure ?? null,
      buyer: buyer ? { name: buyer.name, email: buyer.email } : null,
      sellerOrganisation: listing?.organisation?.name ?? null,
      flaggedAt: flag?.createdAt ?? null,
      reason: flag?.note ?? null,
      resolution: resolved
        ? {
            outcome: resolved.toStatus === 'cancelled' ? 'cancel_order' : 'sale_stands',
            note: resolved.note,
            at: resolved.createdAt,
          }
        : null,
      steps: events.map(toStep),
    };
  });
  // Waiting first, longest-waiting at the top; then the resolved, newest first.
  const waiting = orders
    .filter((order) => order.status === 'disputed')
    .sort((a, b) => (a.flaggedAt?.getTime() ?? 0) - (b.flaggedAt?.getTime() ?? 0));
  const done = orders
    .filter((order) => order.status !== 'disputed')
    .sort((a, b) => (b.resolution?.at.getTime() ?? 0) - (a.resolution?.at.getTime() ?? 0));
  return [...waiting, ...done];
}
