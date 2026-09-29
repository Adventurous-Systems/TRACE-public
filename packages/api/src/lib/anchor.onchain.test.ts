/**
 * On-chain anchoring bookkeeping (no chain needed): what the database and the
 * queue look like around a re-anchor. Regressions from the 2026-09-29
 * visitor-journey rehearsal:
 *   F1: the sweep ignored non-draft passports without a fingerprint.
 *   F2/F4: a re-anchor left the old anchor in place, so a failed job was never
 *          retried and the certificate kept saying "verified".
 *   F3: verify-integrity reported a mismatch while a re-anchor was pending.
 *
 * DEMO_SIMULATE_ANCHOR is switched off for this file before any module that
 * reads the API env is loaded (hence the dynamic imports); vitest isolates
 * modules per test file.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, materialPassports, organisations, type MaterialPassport } from '@trace/db';
import type { anchorQueue as AnchorQueue } from './queue.js';

process.env['DEMO_SIMULATE_ANCHOR'] = 'false';
// Throwaway key for the custodial-wallet test; CI sets none.
process.env['WALLET_ENCRYPTION_KEY'] ??= 'anchor-onchain-test-wallet-encryption-key';

const FAKE_HASH = `0x${'ab'.repeat(32)}`;
const FAKE_TX = `0x${'cd'.repeat(32)}`;
const created: string[] = [];

async function insertPassport(values: Partial<MaterialPassport>): Promise<MaterialPassport> {
  const organisation = await db.query.organisations.findFirst();
  const [row] = await db
    .insert(materialPassports)
    .values({
      productName: 'Anchoring rehearsal regression test',
      categoryL1: 'masonry',
      organisationId: organisation!.id,
      status: 'active',
      ...values,
    })
    .returning();
  created.push(row!.id);
  return row!;
}

describe('on-chain anchoring bookkeeping', () => {
  let anchorQueue: typeof AnchorQueue;

  beforeAll(async () => {
    ({ anchorQueue } = await import('./queue.js'));
  });

  afterAll(async () => {
    for (const id of created) {
      await db.delete(materialPassports).where(eq(materialPassports.id, id));
    }
    await anchorQueue.close();
  });

  it('F1: the sweep selects non-draft passports without a chain transaction, fingerprint or not', async () => {
    const { findUnanchoredPassports } = await import('../workers/anchor-passport.worker.js');
    const hashless = await insertPassport({ status: 'listed' });
    const simulated = await insertPassport({ blockchainPassportHash: FAKE_HASH });
    const draft = await insertPassport({ status: 'draft' });
    const anchored = await insertPassport({
      blockchainPassportHash: FAKE_HASH,
      blockchainTxHash: FAKE_TX,
      blockchainAnchoredAt: new Date(),
    });

    const ids = (await findUnanchoredPassports(10_000)).map((p) => p.id);
    expect(ids).toContain(hashless.id);
    expect(ids).toContain(simulated.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(anchored.id);
  });

  it('F2/F4: an on-chain re-anchor marks the passport pending and queues a job', async () => {
    const { reanchorPassport } = await import('./anchor.js');
    const passport = await insertPassport({
      blockchainPassportHash: FAKE_HASH,
      blockchainTxHash: FAKE_TX,
      blockchainAnchoredAt: new Date(),
    });

    const result = await reanchorPassport(passport);

    expect(result.blockchainTxHash).toBeNull();
    expect(result.blockchainPassportHash).toBeNull();
    expect(result.blockchainAnchoredAt).toBeNull();
    const jobs = await anchorQueue.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs.some((job) => job.data.passportId === passport.id)).toBe(true);
  });

  it('reconciliation marks a stale anchored passport pending and leaves a current one alone', async () => {
    const { reconcileStaleAnchors } = await import('../workers/anchor-passport.worker.js');
    const { computePassportHash } = await import('./passport-hash.js');
    const current = await insertPassport({
      blockchainTxHash: FAKE_TX,
      blockchainAnchoredAt: new Date(),
    });
    await db
      .update(materialPassports)
      .set({ blockchainPassportHash: computePassportHash(current), updatedAt: new Date() })
      .where(eq(materialPassports.id, current.id));
    // Anchored with a hash that no longer matches its data (a change that was
    // never re-anchored, e.g. before reanchorPassport marked passports pending).
    const stale = await insertPassport({
      blockchainPassportHash: FAKE_HASH,
      blockchainTxHash: `0x${'ef'.repeat(32)}`,
      blockchainAnchoredAt: new Date(),
    });

    await reconcileStaleAnchors(10_000);

    const after = async (id: string) =>
      db.query.materialPassports.findFirst({ where: eq(materialPassports.id, id) });
    expect((await after(stale.id))!.blockchainTxHash).toBeNull();
    expect((await after(current.id))!.blockchainTxHash).toBe(FAKE_TX);
  });

  it('F7: the sweep re-queues a passport whose earlier anchor job already completed', async () => {
    const { enqueueSweepAnchor } = await import('../workers/anchor-passport.worker.js');
    const { Worker } = await import('bullmq');
    const { redisConnection } = await import('./queue.js');
    const passport = await insertPassport({});

    // Complete a first `anchor-<id>` job with a stand-in worker, the way the
    // passport's original anchor job finishes in production.
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((resolve) => (resolveDone = resolve));
    const worker = new Worker(
      'anchor-passport',
      async (job) => {
        if (job.data.passportId === passport.id) resolveDone();
      },
      { connection: redisConnection },
    );
    await anchorQueue.add(
      'default',
      { passportId: passport.id, organisationId: passport.organisationId },
      { jobId: `anchor-${passport.id}` },
    );
    await done;
    await worker.close();
    expect(await (await anchorQueue.getJob(`anchor-${passport.id}`))!.getState()).toBe('completed');

    // Before the fix this add was silently dropped (duplicate jobId).
    expect(await enqueueSweepAnchor(passport.id, passport.organisationId)).toBe(true);
    const state = await (await anchorQueue.getJob(`anchor-${passport.id}`))!.getState();
    expect(['waiting', 'prioritized', 'active', 'delayed']).toContain(state);

    // A job that is still waiting is left alone.
    expect(await enqueueSweepAnchor(passport.id, passport.organisationId)).toBe(false);
  });

  // Seen on the live demo: the first sweep anchored a catalogue for one
  // organisation with three concurrent jobs, each created its own wallet, and
  // passports registered with the overwritten keys became un-updatable.
  it('F8: a second wallet claim for an organisation is refused, so no key is ever overwritten', async () => {
    const { claimOrganisationWallet, ensureOrganisationWallet, generateCustodialWallet } =
      await import('./wallet.js');
    const [org] = await db
      .insert(organisations)
      .values({ name: 'Wallet race test hub', type: 'hub', slug: `wallet-race-${Date.now()}` })
      .returning();
    try {
      const first = generateCustodialWallet();
      const second = generateCustodialWallet();
      // Two jobs that both saw "no wallet yet" and generated one each.
      expect(await claimOrganisationWallet(org!.id, first)).toBe(true);
      expect(await claimOrganisationWallet(org!.id, second)).toBe(false);

      const stored = await db.query.organisations.findFirst({
        where: eq(organisations.id, org!.id),
      });
      expect(stored!.blockchainAddress).toBe(first.address);
      // The losing job carries on with the winner's wallet.
      expect((await ensureOrganisationWallet(org!.id)).privateKey).toBe(first.privateKey);
    } finally {
      await db.delete(organisations).where(eq(organisations.id, org!.id));
    }
  });

  it('F3: verify-integrity reports pending, not a mismatch, when no fingerprint is recorded', async () => {
    const { verifyPassportIntegrity } = await import('../modules/passport/passport.service.js');
    const passport = await insertPassport({});

    const result = await verifyPassportIntegrity(passport.id);

    expect(result.pending).toBe(true);
    expect(result.match).toBe(false);
    expect(result.storedHash).toBeNull();
  });
});
