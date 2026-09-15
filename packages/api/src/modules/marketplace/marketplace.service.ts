import { eq, and, or, ilike, gte, lte, desc, asc, sql } from 'drizzle-orm';
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
} from '@trace/core';

type TransactionWithListing = Transaction & { listing: Listing };

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
        },
      },
      organisation: {
        columns: { name: true, slug: true },
      },
    },
  });

  if (!listing) throw new NotFoundError(`Listing ${listingId} not found`);

  return listing as unknown as ListingWithPassport;
}

export async function searchListings(
  query: MarketplaceQueryInput,
): Promise<{ data: ListingWithPassport[]; total: number; page: number; limit: number }> {
  // All filters pushed into SQL — no in-memory post-filtering
  const conditions = [eq(listings.status, 'active')];

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

export async function getMarketplaceStats(): Promise<{
  totalCarbonSavedKg: number;
  activeCount: number;
}> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(cast(${materialPassports.carbonSavingsVsNew} as double precision)), 0)`,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(listings)
    .innerJoin(materialPassports, eq(listings.passportId, materialPassports.id))
    .where(eq(listings.status, 'active'));
  return { totalCarbonSavedKg: Math.round(Number(row?.total ?? 0)), activeCount: row?.count ?? 0 };
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

  const updateSet: Record<string, unknown> = {};
  if (input.pricePence !== undefined) updateSet['pricePence'] = input.pricePence;
  if (input.quantity !== undefined) updateSet['quantity'] = input.quantity;
  if (input.shippingOptions !== undefined) updateSet['shippingOptions'] = input.shippingOptions;
  if (input.expiresAt !== undefined) updateSet['expiresAt'] = input.expiresAt;

  const [updated] = await db
    .update(listings)
    .set(updateSet)
    .where(eq(listings.id, listingId))
    .returning();

  if (!updated) throw new Error('Update failed');
  return updated;
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

export async function makeOffer(input: MakeOfferInput, buyerId: string): Promise<Transaction> {
  return db.transaction(async (tx) => {
    const listing = await tx.query.listings.findFirst({
      where: eq(listings.id, input.listingId),
    });

    if (!listing) throw new NotFoundError(`Listing ${input.listingId} not found`);
    if (listing.status !== 'active') {
      throw new ConflictError(`Listing is not available (status: ${listing.status})`);
    }
    if (listing.sellerId === buyerId) {
      throw new ForbiddenError('Cannot buy your own listing');
    }

    if (listing.expiresAt && listing.expiresAt < new Date()) {
      await tx.update(listings).set({ status: 'expired' }).where(eq(listings.id, listing.id));
      throw new ConflictError('Listing has expired');
    }

    // Claim the active listing before creating its transaction. The status
    // predicate makes this a compare-and-set: concurrent buyers cannot each
    // turn the same listing into a retained pending transaction.
    const [reserved] = await tx
      .update(listings)
      .set({ status: 'reserved' })
      .where(and(eq(listings.id, listing.id), eq(listings.status, 'active')))
      .returning();

    if (!reserved) {
      throw new ConflictError('Listing is no longer available');
    }

    const [transaction] = await tx
      .insert(transactions)
      .values({
        listingId: reserved.id,
        buyerId,
        sellerId: reserved.sellerId,
        amountPence: input.offerPence ?? reserved.pricePence,
        status: 'pending',
        disputeDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000),
        notes: input.notes ?? null,
      })
      .returning();

    if (!transaction) throw new Error('Failed to create transaction');

    await tx
      .update(materialPassports)
      .set({ status: 'reserved', updatedAt: new Date() })
      .where(eq(materialPassports.id, reserved.passportId));

    return transaction;
  });
}
// ─── Transaction: Update Status ──────────────────────────────────────────────

export async function updateTransaction(
  transactionId: string,
  input: UpdateTransactionInput,
  userId: string,
  role: string,
): Promise<Transaction> {
  const txRaw = await db.query.transactions.findFirst({
    where: eq(transactions.id, transactionId),
    with: { listing: true },
  });

  if (!txRaw) throw new NotFoundError(`Transaction ${transactionId} not found`);
  const tx = txRaw as TransactionWithListing;

  // Permission checks by action
  if (input.action === 'confirm_delivery' && tx.buyerId !== userId) {
    throw new ForbiddenError('Only the buyer can confirm delivery');
  }
  if (input.action === 'cancel' && tx.sellerId !== userId && tx.buyerId !== userId) {
    throw new ForbiddenError('Only buyer or seller can cancel');
  }
  if (input.action === 'flag_dispute' && tx.buyerId !== userId) {
    throw new ForbiddenError('Only the buyer can flag a dispute');
  }
  // No dispute-resolution governance exists yet (no arbiter role, no CBT/DAO
  // voting) — platform_admin is the interim authority. Revisit when governance
  // lands; keep this ownership check aligned with the route authorization.
  if (input.action === 'resolve_dispute' && role !== 'platform_admin') {
    throw new ForbiddenError('Only a platform administrator can resolve a dispute');
  }

  let newStatus: string;

  switch (input.action) {
    case 'confirm_delivery':
      if (tx.status !== 'pending' && tx.status !== 'confirmed') {
        throw new ConflictError(
          `Cannot confirm delivery on transaction with status '${tx.status}'`,
        );
      }
      newStatus = 'confirmed';
      break;

    case 'flag_dispute':
      if (tx.status !== 'pending' && tx.status !== 'confirmed') {
        throw new ConflictError(`Cannot flag dispute on transaction with status '${tx.status}'`);
      }
      newStatus = 'disputed';
      break;

    case 'resolve_dispute':
      if (tx.status !== 'disputed') {
        throw new ConflictError('Transaction is not in disputed state');
      }
      newStatus = 'resolved';
      break;

    case 'cancel':
      if (!['pending', 'confirmed'].includes(tx.status)) {
        throw new ConflictError(`Cannot cancel transaction with status '${tx.status}'`);
      }
      newStatus = 'cancelled';
      // Revert listing and passport
      await db.update(listings).set({ status: 'active' }).where(eq(listings.id, tx.listingId));
      await db
        .update(materialPassports)
        .set({ status: 'listed', updatedAt: new Date() })
        .where(eq(materialPassports.id, tx.listing.passportId));
      break;

    default:
      throw new ConflictError('Unknown action');
  }

  const updateSet: Record<string, unknown> = { status: newStatus };
  if (input.notes) updateSet['notes'] = input.notes;

  // If confirmed and past dispute deadline, auto-complete
  if (newStatus === 'confirmed' && tx.disputeDeadline && tx.disputeDeadline < new Date()) {
    updateSet['status'] = 'completed';
    newStatus = 'completed';
  }

  if (newStatus === 'completed') {
    // Mark listing sold, passport sold
    await db.update(listings).set({ status: 'sold' }).where(eq(listings.id, tx.listingId));
    await db
      .update(materialPassports)
      .set({ status: 'sold', updatedAt: new Date() })
      .where(eq(materialPassports.id, tx.listing.passportId));

    // EPCIS transfer event
    await db.insert(passportEvents).values({
      passportId: tx.listing.passportId,
      eventType: 'TransactionEvent',
      eventData: {
        action: 'ADD',
        bizStep: 'urn:epcglobal:cbv:bizstep:selling',
        disposition: 'urn:epcglobal:cbv:disp:sold',
        transactionId,
        buyerId: tx.buyerId,
        amountPence: tx.amountPence,
      },
      actorId: userId,
    });
  }

  const [updated] = await db
    .update(transactions)
    .set(updateSet)
    .where(eq(transactions.id, transactionId))
    .returning();

  if (!updated) throw new Error('Update failed');
  return updated;
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

export async function listUserTransactions(userId: string): Promise<Transaction[]> {
  const data = await db.query.transactions.findMany({
    where: and(
      // buyer or seller
      sql`(${transactions.buyerId} = ${userId} OR ${transactions.sellerId} = ${userId})`,
    ),
    orderBy: [desc(transactions.createdAt)],
  });
  return data;
}
