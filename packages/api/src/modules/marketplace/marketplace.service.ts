import { eq, and, or, ne, inArray, ilike, gte, lte, desc, asc, sql, type SQL } from 'drizzle-orm';
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

  if (!passport) throw new NotFoundError(`Passport ${input.passportId} not found`);
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

  if (!listing) throw new NotFoundError(`Listing ${listingId} not found`);

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

// ─── Listing: Update / Cancel ────────────────────────────────────────────────

export async function updateListing(
  listingId: string,
  input: UpdateListingInput,
  organisationId: string,
): Promise<Listing> {
  const listing = await db.query.listings.findFirst({
    where: eq(listings.id, listingId),
  });

  if (!listing) throw new NotFoundError(`Listing ${listingId} not found`);
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

    const updateSet: Partial<Listing> = {};
    if (input.pricePence !== undefined) updateSet.pricePence = input.pricePence;
    if (input.quantity !== undefined) {
      // Orders already placed keep their share of the lot.
      const committed = current.quantity - current.quantityAvailable;
      if (input.quantity < committed) {
        throw new ConflictError(
          `Orders already hold ${committed} of this lot, so the quantity cannot go below that`,
        );
      }
      updateSet.quantity = input.quantity;
      updateSet.quantityAvailable = input.quantity - committed;
    }
    if (input.minOrderQuantity !== undefined) {
      if (input.minOrderQuantity > (updateSet.quantity ?? current.quantity)) {
        throw new ValidationError('The minimum order cannot be more than the quantity listed');
      }
      updateSet.minOrderQuantity = input.minOrderQuantity;
    }
    if (input.shippingOptions !== undefined) {
      updateSet.shippingOptions = input.shippingOptions as Listing['shippingOptions'];
    }
    if (input.expiresAt !== undefined) updateSet.expiresAt = input.expiresAt;
    // A lot whose remaining stock is all ordered is no longer on offer.
    if (updateSet.quantityAvailable === 0) updateSet.status = 'reserved';

    const [updated] = await tx
      .update(listings)
      .set(updateSet)
      .where(eq(listings.id, listingId))
      .returning();

    if (!updated) throw new Error('Update failed');
    return updated;
  });
}

export async function cancelListing(listingId: string, organisationId: string): Promise<Listing> {
  const listing = await db.query.listings.findFirst({
    where: eq(listings.id, listingId),
  });

  if (!listing) throw new NotFoundError(`Listing ${listingId} not found`);
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

// ─── Transaction: Make Offer ─────────────────────────────────────────────────

/**
 * Order part (or all) of a lot. The order holds its quantity until it is
 * completed, resolved or cancelled; the listing stays on the marketplace while
 * anything is left, and is reserved once every unit is held.
 */
export async function makeOffer(input: MakeOfferInput, buyerId: string): Promise<Transaction> {
  return db.transaction(async (tx) => {
    // Lock the listing: concurrent offers on one lot queue here, so between
    // them buyers can never take more than is available.
    const [listing] = await tx
      .select()
      .from(listings)
      .where(eq(listings.id, input.listingId))
      .for('update');

    if (!listing) throw new NotFoundError(`Listing ${input.listingId} not found`);
    if (listing.status !== 'active') {
      throw new ConflictError(`Listing is not available (status: ${listing.status})`);
    }
    if (listing.sellerId === buyerId) {
      throw new ForbiddenError('Cannot buy your own listing');
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

    const remaining = available - quantity;
    await tx
      .update(listings)
      .set({ quantityAvailable: remaining, ...(remaining === 0 ? { status: 'reserved' } : {}) })
      .where(eq(listings.id, listing.id));

    const unitPricePence = input.offerPence ?? listing.pricePence;
    const [transaction] = await tx
      .insert(transactions)
      .values({
        listingId: listing.id,
        buyerId,
        sellerId: listing.sellerId,
        quantity,
        amountPence: unitPricePence * quantity,
        status: 'pending',
        // The dispute window opens when the seller accepts.
        disputeDeadline: null,
        notes: input.notes ?? null,
      })
      .returning();

    if (!transaction) throw new Error('Failed to create transaction');

    if (remaining === 0) {
      await tx
        .update(materialPassports)
        .set({ status: 'reserved', updatedAt: new Date() })
        .where(eq(materialPassports.id, listing.passportId));
    }

    return transaction;
  });
}

// ─── Transaction: Update Status ──────────────────────────────────────────────

const DISPUTE_WINDOW_MS = 48 * 60 * 60 * 1000;

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
 * A buyer can't confirm delivery of an order the seller hasn't accepted.
 */
const TRANSITIONS: Record<
  UpdateTransactionInput['action'],
  { from: readonly string[]; to: string; by: 'buyer' | 'seller' | 'party' | 'platform_admin' }
> = {
  accept: { from: ['pending'], to: 'confirmed', by: 'seller' },
  reject: { from: ['pending'], to: 'cancelled', by: 'seller' },
  cancel: { from: ['pending', 'confirmed'], to: 'cancelled', by: 'party' },
  confirm_delivery: { from: ['confirmed'], to: 'completed', by: 'buyer' },
  flag_dispute: { from: ['confirmed'], to: 'disputed', by: 'buyer' },
  resolve_dispute: { from: ['disputed'], to: 'resolved', by: 'platform_admin' },
};

const ACTION_WORDING: Record<UpdateTransactionInput['action'], string> = {
  accept: 'accept',
  reject: 'reject',
  cancel: 'cancel',
  confirm_delivery: 'confirm delivery of',
  flag_dispute: 'flag a problem with',
  resolve_dispute: 'resolve',
};

export async function updateTransaction(
  transactionId: string,
  input: UpdateTransactionInput,
  userId: string,
  role: string,
): Promise<Transaction> {
  const step = TRANSITIONS[input.action];
  if (!step) throw new ConflictError('Unknown action');

  return db.transaction(async (dbTx) => {
    const [order] = await dbTx
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .for('update');
    if (!order) throw new NotFoundError(`Transaction ${transactionId} not found`);

    const isBuyer = order.buyerId === userId;
    const isSeller = order.sellerId === userId;
    // No dispute-resolution governance exists yet (no arbiter role, no CBT/DAO
    // voting) — platform_admin is the interim authority. Revisit when governance
    // lands; keep this ownership check aligned with the route authorization.
    const allowed =
      (step.by === 'buyer' && isBuyer) ||
      (step.by === 'seller' && isSeller) ||
      (step.by === 'party' && (isBuyer || isSeller)) ||
      (step.by === 'platform_admin' && role === 'platform_admin');
    if (!allowed) {
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

    const [listing] = await dbTx
      .select()
      .from(listings)
      .where(eq(listings.id, order.listingId))
      .for('update');
    if (!listing) throw new NotFoundError(`Listing ${order.listingId} not found`);

    const updateSet: Partial<Transaction> = { status: step.to };
    if (input.notes) updateSet.notes = input.notes;
    if (step.to === 'confirmed') {
      updateSet.disputeDeadline = new Date(Date.now() + DISPUTE_WINDOW_MS);
    }

    if (step.to === 'cancelled') {
      // Give the order's share back to the lot. A lot that was fully held
      // returns to the marketplace.
      const reopened = listing.status === 'reserved';
      await dbTx
        .update(listings)
        .set({
          quantityAvailable: Math.min(listing.quantity, listing.quantityAvailable + order.quantity),
          ...(reopened ? { status: 'active' } : {}),
        })
        .where(eq(listings.id, listing.id));
      if (reopened) {
        await dbTx
          .update(materialPassports)
          .set({ status: 'listed', updatedAt: new Date() })
          .where(eq(materialPassports.id, listing.passportId));
      }
    }

    if (step.to === 'completed' || step.to === 'resolved') {
      // The lot is sold once nothing is left and no other order is open.
      const [others] = await dbTx
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(transactions)
        .where(
          and(
            eq(transactions.listingId, listing.id),
            ne(transactions.id, order.id),
            inArray(transactions.status, [...OPEN_TRANSACTION_STATUSES]),
          ),
        );
      if (listing.quantityAvailable === 0 && (others?.count ?? 0) === 0) {
        await dbTx.update(listings).set({ status: 'sold' }).where(eq(listings.id, listing.id));
        await dbTx
          .update(materialPassports)
          .set({ status: 'sold', updatedAt: new Date() })
          .where(eq(materialPassports.id, listing.passportId));
      }

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
        actorId: userId,
      });
    }

    const [updated] = await dbTx
      .update(transactions)
      .set(updateSet)
      .where(and(eq(transactions.id, transactionId), eq(transactions.status, order.status)))
      .returning();

    if (!updated)
      throw new ConflictError('The order changed while this was being saved; try again');
    return updated;
  });
}

export async function getTransactionById(
  transactionId: string,
  userId: string,
  role: string,
): Promise<Transaction> {
  const tx = await db.query.transactions.findFirst({
    where: eq(transactions.id, transactionId),
  });
  if (!tx) throw new NotFoundError(`Transaction ${transactionId} not found`);

  // Object-level scope: buyer, seller or platform_admin only. 404 rather than
  // 403 for everyone else — same pattern as getPassportById's draft scoping —
  // so an unrelated account can't even confirm the id exists.
  const isParty = tx.buyerId === userId || tx.sellerId === userId;
  if (!isParty && role !== 'platform_admin') {
    throw new NotFoundError(`Transaction ${transactionId} not found`);
  }

  return tx;
}

/**
 * A user's orders, each with the material it is for. Before this the Orders
 * page showed only a status and an amount, not which material the order was
 * for (2026-09-29 rehearsal, T1).
 */
export async function listUserTransactions(
  userId: string,
): Promise<Array<Transaction & { productName: string | null; passportId: string | null }>> {
  const data = await db.query.transactions.findMany({
    where: and(
      // buyer or seller
      sql`(${transactions.buyerId} = ${userId} OR ${transactions.sellerId} = ${userId})`,
    ),
    orderBy: [desc(transactions.createdAt)],
    with: {
      listing: {
        columns: { passportId: true },
        with: { passport: { columns: { productName: true, unitOfMeasure: true } } },
      },
    },
  });
  return data.map(({ listing, ...tx }) => ({
    ...tx,
    passportId: listing?.passportId ?? null,
    productName: listing?.passport?.productName ?? null,
    unitOfMeasure: listing?.passport?.unitOfMeasure ?? null,
  }));
}
