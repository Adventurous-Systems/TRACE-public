/**
 * API edge-case probes: inputs, sequences and races a browser will not
 * produce, each with the outcome it should have. Anything else is a finding.
 *
 * They use lots created for the purpose by the supplier persona and orders
 * from freshly registered buyers, so the curated catalogue is left alone.
 */
import { request } from '@playwright/test';
import { createListedPassport } from '../fixtures/api';
import { uniqueName } from '../fixtures/test-helpers';
import type { ApiResponse, Rehearsal, Severity } from './harness';

type Session = { token: string; user: { id: string } };
interface Order {
  id: string;
  status: string;
  quantity: number;
  amountPence: number;
}
interface Lot {
  status: string;
  quantity: number;
  quantityAvailable: number;
}

export async function runProbes(rehearsal: Rehearsal): Promise<void> {
  console.log('\n── API probes');
  const seller = await rehearsal.persona('supplier');
  const admin = await rehearsal.persona('platformAdmin');
  const staff = await rehearsal.persona('hubStaff');
  const buyer = await rehearsal.register('probe buyer');
  const other = await rehearsal.register('probe other');
  const ctx = await request.newContext();

  const newLot = async (opts: {
    quantity: number;
    minOrderQuantity?: number;
    pricePence?: number;
    expiresAt?: string;
  }) =>
    (
      await createListedPassport(ctx, seller.token, {
        productName: uniqueName('Rehearsal Probe Lot'),
        pricePence: 300,
        ...opts,
      })
    ).listingId;
  const offer = (who: Session | null, listingId: string, body: Record<string, unknown> = {}) =>
    rehearsal.api<Order>('POST', '/api/v1/marketplace/offers', {
      ...(who ? { token: who.token } : {}),
      body: { listingId, ...body },
    });
  // Flagging needs a reason and resolving an outcome and a reason; a probe
  // about something else sends them, one about them overrides them.
  const SAID: Record<string, Record<string, unknown>> = {
    flag_dispute: { notes: 'Rehearsal probe: damaged on arrival.' },
    resolve_dispute: { outcome: 'sale_stands', notes: 'Rehearsal probe: the sale stands.' },
  };
  const act = (
    who: Session,
    orderId: string,
    action: string,
    extra: Record<string, unknown> = {},
  ) =>
    rehearsal.api<Order>('PATCH', `/api/v1/marketplace/transactions/${orderId}`, {
      token: who.token,
      body: { action, ...SAID[action], ...extra },
    });
  const lot = async (listingId: string) =>
    (await rehearsal.api<Lot>('GET', `/api/v1/marketplace/listings/${listingId}`)).body.data!;
  const patchLot = (listingId: string, body: Record<string, unknown>) =>
    rehearsal.api<Lot>('PATCH', `/api/v1/marketplace/listings/${listingId}`, {
      token: seller.token,
      body,
    });
  const placed = async (who: Session, listingId: string, quantity: number) => {
    const res = await offer(who, listingId, { quantity });
    if (res.status !== 201) throw new Error(`setup order failed: HTTP ${res.status}`);
    return res.body.data!.id;
  };

  /** Record one probe; an unexpected outcome becomes a finding. */
  async function probe(
    name: string,
    expected: string,
    run: () => Promise<{ pass: boolean; actual: string }>,
    onFail: { severity: Severity; type: string; known?: string } = {
      severity: 'major',
      type: 'edge case',
    },
  ): Promise<void> {
    let outcome: { pass: boolean; actual: string };
    try {
      outcome = await run();
    } catch (error) {
      outcome = { pass: false, actual: `probe error: ${String(error).split('\n')[0]}` };
    }
    rehearsal.probes.push({ name, expected, ...outcome });
    console.log(`  ${outcome.pass ? '✓' : '✗'} ${name}: ${outcome.actual}`);
    if (!outcome.pass) {
      // A caveat the owner has deferred is recorded, not raised again.
      rehearsal.finding({
        source: `probe: ${name}`,
        severity: onFail.known ? 'info' : onFail.severity,
        type: onFail.known ? `known (${onFail.known})` : onFail.type,
        what: `expected ${expected}; got ${outcome.actual}`,
      });
    }
  }
  const says = (res: ApiResponse) =>
    `HTTP ${res.status}${res.body.error?.message ? ` "${res.body.error.message.slice(0, 90)}"` : ''}`;
  const expectStatus = (res: ApiResponse, ...allowed: number[]) => ({
    pass: allowed.includes(res.status),
    actual: says(res),
  });

  // ── What a quantity may be ───────────────────────────────────────────────
  const basic = await newLot({ quantity: 10, minOrderQuantity: 2 });
  for (const quantity of [0, -5, 1.5, 'abc']) {
    await probe(`order quantity ${JSON.stringify(quantity)}`, 'HTTP 400', async () =>
      expectStatus(await offer(buyer, basic, { quantity }), 400),
    );
  }
  for (const quantity of [2147483648, 1e20]) {
    await probe(`order quantity ${quantity}`, 'refused (HTTP 400 or 409)', async () =>
      expectStatus(await offer(buyer, basic, { quantity }), 400, 409),
    );
  }
  await probe('order more than is available (11 of 10)', 'HTTP 409', async () =>
    expectStatus(await offer(buyer, basic, { quantity: 11 }), 409),
  );
  await probe('order below the minimum (1, minimum 2)', 'HTTP 400', async () =>
    expectStatus(await offer(buyer, basic, { quantity: 1 }), 400),
  );
  await probe('order with a 501-character note', 'HTTP 400', async () =>
    expectStatus(await offer(buyer, basic, { quantity: 2, notes: 'x'.repeat(501) }), 400),
  );
  await probe(
    'the remainder may be bought even when it is below the minimum',
    'HTTP 201',
    async () => {
      await placed(buyer, basic, 9);
      return expectStatus(await offer(other, basic, { quantity: 1 }), 201);
    },
  );
  await probe(
    'a lot with everything ordered is reserved, with 0 available',
    'reserved, 0',
    async () => {
      const now = await lot(basic);
      return {
        pass: now.status === 'reserved' && now.quantityAvailable === 0,
        actual: `${now.status}, ${now.quantityAvailable}`,
      };
    },
  );

  // ── Money ────────────────────────────────────────────────────────────────
  await probe('order total beyond the limit (2 × £15,000,000.00)', 'HTTP 400', async () => {
    const dear = await newLot({ quantity: 2, pricePence: 1_500_000_000 });
    return expectStatus(await offer(buyer, dear, { quantity: 2 }), 400);
  });
  await probe(
    'a buyer names their own unit price (1p against £3.00 asking)',
    'ignored: charged the asking price, 1500p for 5',
    async () => {
      const cheap = await newLot({ quantity: 5 });
      const res = await offer(buyer, cheap, { quantity: 5, offerPence: 1 });
      return {
        pass: res.status === 201 && res.body.data?.amountPence === 1500,
        actual: `${says(res)}; order total ${res.body.data?.amountPence}p`,
      };
    },
  );

  // ── Who may order ────────────────────────────────────────────────────────
  const open = await newLot({ quantity: 20 });
  await probe('order without signing in', 'HTTP 401', async () =>
    expectStatus(await offer(null, open, { quantity: 1 }), 401),
  );
  await probe('a seller orders their own lot', 'HTTP 403', async () =>
    expectStatus(await offer(seller, open, { quantity: 1 }), 403),
  );
  await probe('order from a listing that does not exist', 'HTTP 404', async () =>
    expectStatus(await offer(buyer, '00000000-0000-4000-8000-000000000000', { quantity: 1 }), 404),
  );
  await probe('order with a malformed listing id', 'HTTP 400', async () =>
    expectStatus(await offer(buyer, 'not-a-uuid', { quantity: 1 }), 400),
  );
  await probe('a public visitor account creates a listing', 'HTTP 403', async () =>
    expectStatus(
      await rehearsal.api('POST', '/api/v1/marketplace/listings', {
        token: buyer.token,
        body: {
          passportId: '00000000-0000-4000-8000-000000000000',
          pricePence: 100,
          quantity: 1,
          shippingOptions: [{ method: 'collection' }],
        },
      }),
      403,
    ),
  );

  // ── Ten buyers at once ───────────────────────────────────────────────────
  await probe(
    '10 simultaneous orders of 3 on a lot of 10',
    'exactly 3 accepted, 7 refused with HTTP 409, 1 left',
    async () => {
      const racy = await newLot({ quantity: 10 });
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => offer(i % 2 ? buyer : other, racy, { quantity: 3 })),
      );
      const codes = results.map((r) => r.status).sort();
      const left = (await lot(racy)).quantityAvailable;
      return {
        pass:
          codes.filter((c) => c === 201).length === 3 &&
          codes.filter((c) => c === 409).length === 7 &&
          left === 1,
        actual: `statuses ${codes.join(',')}; ${left} left`,
      };
    },
    { severity: 'blocker', type: 'bug' },
  );

  // ── The order steps, allowed and refused ─────────────────────────────────
  const stepsLot = await newLot({ quantity: 5 });
  const first = await placed(buyer, stepsLot, 2);
  const refusals: Array<[string, Session, string, number]> = [
    ['the buyer confirms delivery before the seller accepts', buyer, 'confirm_delivery', 409],
    ['the buyer accepts their own order', buyer, 'accept', 403],
    ['the buyer flags a problem before the seller accepts', buyer, 'flag_dispute', 409],
    ['the seller confirms delivery', seller, 'confirm_delivery', 403],
    ['a stranger cancels the order', other, 'cancel', 403],
    ['hub staff of another organisation accept the order', staff, 'accept', 403],
    ['an unknown action', buyer, 'explode', 400],
  ];
  for (const [name, who, action, status] of refusals) {
    await probe(name, `HTTP ${status}`, async () =>
      expectStatus(await act(who, first, action), status),
    );
  }
  await probe('a stranger reads the order', 'HTTP 404', async () =>
    expectStatus(
      await rehearsal.api('GET', `/api/v1/marketplace/transactions/${first}`, {
        token: other.token,
      }),
      404,
    ),
  );
  await probe(
    'the seller accepts twice at the same moment',
    'one HTTP 200 and one HTTP 409',
    async () => {
      const codes = (
        await Promise.all([act(seller, first, 'accept'), act(seller, first, 'accept')])
      )
        .map((r) => r.status)
        .sort();
      return { pass: codes.join() === '200,409', actual: `statuses ${codes.join(',')}` };
    },
  );
  await probe(
    'the buyer confirms delivery of an accepted order',
    'HTTP 200, completed',
    async () => {
      const res = await act(buyer, first, 'confirm_delivery');
      return {
        pass: res.body.data?.status === 'completed',
        actual: `${says(res)} ${res.body.data?.status}`,
      };
    },
  );
  for (const [name, who, action] of [
    ['confirm delivery of a completed order again', buyer, 'confirm_delivery'],
    ['the buyer cancels a completed order', buyer, 'cancel'],
    ['the seller cancels a completed order', seller, 'cancel'],
    ['flag a problem on a completed order', buyer, 'flag_dispute'],
  ] as const) {
    await probe(name, 'HTTP 409', async () => expectStatus(await act(who, first, action), 409));
  }
  await probe('a part-sold lot stays active with the rest available', 'active, 3', async () => {
    const now = await lot(stepsLot);
    return {
      pass: now.status === 'active' && now.quantityAvailable === 3,
      actual: `${now.status}, ${now.quantityAvailable}`,
    };
  });

  await probe(
    'the buyer cancels while the seller accepts',
    'the order ends cancelled and its unit is back on sale, whichever came first',
    async () => {
      const before = (await lot(stepsLot)).quantityAvailable;
      const racing = await placed(buyer, stepsLot, 1);
      const codes = (
        await Promise.all([act(buyer, racing, 'cancel'), act(seller, racing, 'accept')])
      )
        .map((r) => r.status)
        .sort();
      const order = (
        await rehearsal.api<Order>('GET', `/api/v1/marketplace/transactions/${racing}`, {
          token: buyer.token,
        })
      ).body.data;
      const after = (await lot(stepsLot)).quantityAvailable;
      return {
        // Accept-then-cancel (200, 200) and cancel-then-accept (200, 409) are both legal.
        pass: order?.status === 'cancelled' && after === before && codes[0] === 200,
        actual: `statuses ${codes.join(',')}; order ${order?.status}; available ${before} → ${after}`,
      };
    },
    { severity: 'blocker', type: 'bug' },
  );

  // ── A problem, and its resolution ────────────────────────────────────────
  const disputeLot = await newLot({ quantity: 1 });
  const disputed = await placed(buyer, disputeLot, 1);
  await act(seller, disputed, 'accept');
  for (const [name, notes] of [
    ['without saying what it is', undefined],
    ['with two characters', 'no'],
  ] as const) {
    await probe(`the buyer flags a problem ${name}`, 'HTTP 400', async () =>
      expectStatus(await act(buyer, disputed, 'flag_dispute', { notes }), 400),
    );
  }
  await probe('the buyer flags a problem on an accepted order', 'HTTP 200, disputed', async () => {
    const res = await act(buyer, disputed, 'flag_dispute');
    return {
      pass: res.body.data?.status === 'disputed',
      actual: `${says(res)} ${res.body.data?.status}`,
    };
  });
  for (const [name, who] of [
    ['the seller resolves the dispute', seller],
    ['the buyer resolves the dispute', buyer],
  ] as const) {
    await probe(name, 'HTTP 403', async () =>
      expectStatus(await act(who, disputed, 'resolve_dispute'), 403),
    );
  }
  await probe('a disputed order can be cancelled by neither side', 'HTTP 409', async () =>
    expectStatus(await act(buyer, disputed, 'cancel'), 409),
  );
  for (const [name, extra] of [
    ['without an outcome', { outcome: undefined }],
    ['without a reason', { notes: undefined }],
    ['with an outcome that does not exist', { outcome: 'refund' }],
  ] as const) {
    await probe(`the platform admin resolves ${name}`, 'HTTP 400', async () =>
      expectStatus(await act(admin, disputed, 'resolve_dispute', extra), 400),
    );
  }
  await probe('a seller reads the list of flagged orders', 'HTTP 403', async () =>
    expectStatus(
      await rehearsal.api('GET', '/api/v1/marketplace/transactions/flagged', {
        token: seller.token,
      }),
      403,
    ),
  );
  await probe(
    'the platform admin reads it: the order, the reason, both parties',
    'listed with its reason',
    async () => {
      const res = await rehearsal.api<
        Array<{ id: string; reason: string | null; buyer: unknown; sellerOrganisation: string }>
      >('GET', '/api/v1/marketplace/transactions/flagged', { token: admin.token });
      const found = res.body.data?.find((o) => o.id === disputed);
      return {
        pass: !!found?.reason && !!found.buyer && !!found.sellerOrganisation,
        actual: `${says(res)} reason "${found?.reason ?? 'none'}"`,
      };
    },
  );
  await probe('the platform admin resolves the dispute', 'HTTP 200, resolved', async () => {
    const res = await act(admin, disputed, 'resolve_dispute');
    return {
      pass: res.body.data?.status === 'resolved',
      actual: `${says(res)} ${res.body.data?.status}`,
    };
  });
  await probe('a lot whose only unit was disputed then resolved is sold', 'sold, 0', async () => {
    const now = await lot(disputeLot);
    return {
      pass: now.status === 'sold' && now.quantityAvailable === 0,
      actual: `${now.status}, ${now.quantityAvailable}`,
    };
  });

  await probe(
    'both sides read the steps of the order, and no user id',
    'placed, accept, flag_dispute, resolve_dispute',
    async () => {
      const read = async (who: Session) =>
        (
          await rehearsal.api<Array<{ id: string; steps: Array<{ action: string }> }>>(
            'GET',
            '/api/v1/marketplace/transactions',
            { token: who.token },
          )
        ).body.data?.find((o) => o.id === disputed)?.steps ?? [];
      const [forBuyer, forSeller] = [await read(buyer), await read(seller)];
      const actions = forBuyer.map((s) => s.action).join(', ');
      const text = JSON.stringify([forBuyer, forSeller]);
      const leaks = [buyer.user.id, seller.user.id, admin.user.id].filter((id) =>
        text.includes(id),
      );
      return {
        pass:
          actions === 'placed, accept, flag_dispute, resolve_dispute' &&
          forSeller.length === 4 &&
          leaks.length === 0,
        actual: `${actions}; ${leaks.length} user id(s)`,
      };
    },
  );
  const undoneLot = await newLot({ quantity: 2 });
  const undone = await placed(buyer, undoneLot, 2);
  await act(seller, undone, 'accept');
  await act(buyer, undone, 'flag_dispute');
  await probe(
    'the platform admin resolves a dispute by cancelling the order',
    'cancelled; the lot is back on sale with 2',
    async () => {
      const res = await act(admin, undone, 'resolve_dispute', {
        outcome: 'cancel_order',
        notes: 'Rehearsal probe: the seller agrees.',
      });
      const now = await lot(undoneLot);
      return {
        pass:
          res.body.data?.status === 'cancelled' &&
          now.status === 'active' &&
          now.quantityAvailable === 2,
        actual: `${says(res)} ${res.body.data?.status}; lot ${now.status}, ${now.quantityAvailable}`,
      };
    },
  );
  await probe('a resolved order is resolved again', 'HTTP 409', async () =>
    expectStatus(await act(admin, undone, 'resolve_dispute'), 409),
  );

  // ── Time limits ──────────────────────────────────────────────────────────
  // The limits are 72 and 48 hours; a probe moves the order's deadline into
  // the past instead of waiting. That needs the stack's database.
  if (!rehearsal.canSql) {
    rehearsal.finding({
      source: 'probes: time limits',
      severity: 'info',
      type: 'not run',
      what: 'REHEARSAL_PSQL is not set, so the time-limit probes were skipped',
    });
  } else {
    const overdue = (orderId: string, column: 'response_deadline' | 'dispute_deadline') =>
      rehearsal.sql(
        `update transactions set ${column} = now() - interval '1 minute' where id = '${orderId}'`,
      );
    const until = async (done: () => Promise<boolean>, seconds: number) => {
      for (let waited = 0; waited < seconds; waited += 5) {
        if (await done()) return waited;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      return (await done()) ? seconds : -1;
    };

    const lateLot = await newLot({ quantity: 4 });
    const late = await placed(buyer, lateLot, 4);
    overdue(late, 'response_deadline');
    await probe(
      'the seller accepts an order after its 72 hours',
      'HTTP 409, it lapsed; the lot is back on sale with 4',
      async () => {
        const res = await act(seller, late, 'accept');
        const now = await lot(lateLot);
        return {
          pass: res.status === 409 && now.status === 'active' && now.quantityAvailable === 4,
          actual: `${says(res)}; lot ${now.status}, ${now.quantityAvailable}`,
        };
      },
    );

    const windowLot = await newLot({ quantity: 1 });
    const windowed = await placed(buyer, windowLot, 1);
    await act(seller, windowed, 'accept');
    overdue(windowed, 'dispute_deadline');
    await probe(
      'the buyer flags a problem after the 48 hours',
      'HTTP 409, it completed; the lot is sold',
      async () => {
        const res = await act(buyer, windowed, 'flag_dispute');
        const now = await lot(windowLot);
        return {
          pass: res.status === 409 && now.status === 'sold',
          actual: `${says(res)}; lot ${now.status}`,
        };
      },
    );

    // Nobody opens these two: only the sweep can close them.
    const quietLot = await newLot({ quantity: 3 });
    const quiet = await placed(buyer, quietLot, 3);
    const soldLot = await newLot({ quantity: 1 });
    const sold = await placed(buyer, soldLot, 1);
    await act(seller, sold, 'accept');
    overdue(quiet, 'response_deadline');
    overdue(sold, 'dispute_deadline');
    await probe(
      'the sweep lapses an unanswered order nobody is looking at',
      'within 90 s the lot is back on sale with 3',
      async () => {
        const waited = await until(async () => (await lot(quietLot)).quantityAvailable === 3, 90);
        const now = await lot(quietLot);
        return {
          pass: waited >= 0 && now.status === 'active',
          actual: `${waited < 0 ? 'not within 90 s' : `after ~${waited} s`}; lot ${now.status}, ${now.quantityAvailable}`,
        };
      },
      { severity: 'blocker', type: 'ops' },
    );
    await probe(
      'the sweep completes an accepted order past its problem window',
      'within 90 s the lot is sold',
      async () => {
        const waited = await until(async () => (await lot(soldLot)).status === 'sold', 90);
        return {
          pass: waited >= 0,
          actual: `${waited < 0 ? 'not within 90 s' : `after ~${waited} s`}; lot ${(await lot(soldLot)).status}`,
        };
      },
      { severity: 'blocker', type: 'ops' },
    );
    await probe(
      'an order a time limit closed says so in its steps',
      'lapse by time_limit',
      async () => {
        const steps =
          (
            await rehearsal.api<
              Array<{ id: string; steps: Array<{ action: string; actorSide: string }> }>
            >('GET', '/api/v1/marketplace/transactions', { token: buyer.token })
          ).body.data?.find((o) => o.id === quiet)?.steps ?? [];
        const last = steps.at(-1);
        return {
          pass: last?.action === 'lapse' && last.actorSide === 'time_limit',
          actual: `${last?.action} by ${last?.actorSide}`,
        };
      },
    );
  }

  // ── What waits for whom ──────────────────────────────────────────────────
  const fresh = await rehearsal.register('probe counts');
  const countsOf = async (who: Session) =>
    (
      await rehearsal.api<{ needsAction: number; changed: number; flagged: number }>(
        'GET',
        '/api/v1/marketplace/transactions/summary',
        { token: who.token },
      )
    ).body.data ?? { needsAction: -1, changed: -1, flagged: -1 };
  const countedLot = await newLot({ quantity: 2 });
  const sellerBefore = await countsOf(seller);
  const counted = await placed(fresh, countedLot, 1);
  await probe(
    'a new order waits for the seller, not for its buyer',
    'seller +1; buyer 0',
    async () => {
      const [forSeller, forBuyer] = [await countsOf(seller), await countsOf(fresh)];
      return {
        pass: forSeller.needsAction === sellerBefore.needsAction + 1 && forBuyer.needsAction === 0,
        actual: `seller ${sellerBefore.needsAction} → ${forSeller.needsAction}; buyer ${forBuyer.needsAction}`,
      };
    },
  );
  await act(seller, counted, 'accept');
  await probe(
    'once accepted it waits for the buyer, and is new to them until they look',
    'waits 1, changed 1; after looking, changed 0',
    async () => {
      const before = await countsOf(fresh);
      const seen = await rehearsal.api('POST', '/api/v1/marketplace/transactions/seen', {
        token: fresh.token,
        body: {},
      });
      const after = await countsOf(fresh);
      return {
        pass:
          before.needsAction === 1 &&
          before.changed === 1 &&
          seen.status === 200 &&
          after.changed === 0,
        actual: `waits ${before.needsAction}, changed ${before.changed}; after looking (${says(seen)}), changed ${after.changed}`,
      };
    },
  );
  await probe('the counts without signing in', 'HTTP 401', async () =>
    expectStatus(await rehearsal.api('GET', '/api/v1/marketplace/transactions/summary'), 401),
  );

  // ── What a seller may do under open orders ───────────────────────────────
  const held = await newLot({ quantity: 6 });
  await placed(buyer, held, 4);
  await probe('the seller cancels a listing with an open order', 'HTTP 409', async () =>
    expectStatus(await patchLot(held, { action: 'cancel' }), 409),
  );
  await probe('the seller shrinks the lot below what is ordered (3 < 4)', 'HTTP 409', async () =>
    expectStatus(await patchLot(held, { quantity: 3 }), 409),
  );
  await probe('the seller sets a minimum order above the lot size', 'HTTP 400', async () =>
    expectStatus(await patchLot(held, { minOrderQuantity: 99 }), 400),
  );
  await probe('the seller adds stock (6 → 10)', 'HTTP 200, 6 available', async () => {
    const res = await patchLot(held, { quantity: 10 });
    return {
      pass: res.status === 200 && res.body.data?.quantityAvailable === 6,
      actual: `${says(res)}, ${res.body.data?.quantityAvailable} available`,
    };
  });
  await probe(
    'the seller shrinks the lot to exactly what is ordered (10 → 4)',
    'HTTP 200, reserved, 0 available',
    async () => {
      const res = await patchLot(held, { quantity: 4 });
      return {
        pass: res.status === 200 && res.body.data?.status === 'reserved',
        actual: `${says(res)}, ${res.body.data?.status}, ${res.body.data?.quantityAvailable} available`,
      };
    },
  );
  await probe(
    'the seller adds stock to a lot whose stock is all ordered',
    'HTTP 200, back on the marketplace',
    async () => {
      const res = await patchLot(held, { quantity: 8 });
      return { pass: res.status === 200, actual: says(res) };
    },
    { severity: 'minor', type: 'caveat', known: 'F6, deferred with lot editing' },
  );

  await probe(
    'the seller shrinks a lot to exactly what has been sold and delivered',
    'the lot is sold',
    async () => {
      const partSold = await newLot({ quantity: 4 });
      const sale = await placed(buyer, partSold, 2);
      await act(seller, sale, 'accept');
      await act(buyer, sale, 'confirm_delivery');
      const res = await patchLot(partSold, { quantity: 2 });
      const now = await lot(partSold);
      return { pass: now.status === 'sold', actual: `${says(res)}; listing is ${now.status}` };
    },
  );

  // ── Expiry ───────────────────────────────────────────────────────────────
  await probe(
    'a listing past its date',
    'an order is refused (HTTP 409), it is out of browse, and within 90 s it reads expired',
    async () => {
      const brief = await newLot({
        quantity: 3,
        expiresAt: new Date(Date.now() + 2500).toISOString(),
      });
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const res = await offer(buyer, brief, { quantity: 1 });
      const browse = await rehearsal.api<{ data: Array<{ id: string }> }>(
        'GET',
        '/api/v1/marketplace/listings?limit=50&sortBy=createdAt&sortOrder=desc',
      );
      const listed = (browse.body.data?.data ?? []).some((l) => l.id === brief);
      let waited = 0;
      while (waited < 90 && (await lot(brief)).status !== 'expired') {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        waited += 5;
      }
      const now = await lot(brief);
      return {
        pass: res.status === 409 && !listed && now.status === 'expired',
        actual: `${says(res)}; ${listed ? 'STILL in browse' : 'out of browse'}; listing is ${now.status} after ~${waited} s`,
      };
    },
  );

  // ── A hub's orders belong to the hub ─────────────────────────────────────
  const hubAdmin = await rehearsal.persona('hubAdmin');
  const hubLot = (
    await createListedPassport(ctx, hubAdmin.token, {
      productName: uniqueName('Rehearsal Hub Lot'),
      pricePence: 300,
      quantity: 4,
    })
  ).listingId;
  const hubOrder = await placed(buyer, hubLot, 1);
  const ordersOf = async (who: Session) =>
    (
      await rehearsal.api<Array<{ id: string; viewerSide: string; allowedActions: string[] }>>(
        'GET',
        '/api/v1/marketplace/transactions',
        { token: who.token },
      )
    ).body.data ?? [];
  await probe(
    'hub staff see an order on a lot the hub admin listed',
    'listed for them as seller, with accept, reject and cancel',
    async () => {
      const seen = (await ordersOf(staff)).find((o) => o.id === hubOrder);
      return {
        pass:
          seen?.viewerSide === 'seller' &&
          seen.allowedActions.sort().join() === 'accept,cancel,reject',
        actual: seen
          ? `${seen.viewerSide}: ${seen.allowedActions.join(', ')}`
          : 'not in their list',
      };
    },
  );
  await probe(
    'a seller of another organisation does not see that order',
    'not in their list',
    async () => {
      const seen = (await ordersOf(seller)).some((o) => o.id === hubOrder);
      return { pass: !seen, actual: seen ? 'in their list' : 'not in their list' };
    },
  );
  await probe('a seller of another organisation reads that order', 'HTTP 404', async () =>
    expectStatus(
      await rehearsal.api('GET', `/api/v1/marketplace/transactions/${hubOrder}`, {
        token: seller.token,
      }),
      404,
    ),
  );
  await probe('a seller of another organisation accepts that order', 'HTTP 403', async () =>
    expectStatus(await act(seller, hubOrder, 'accept'), 403),
  );
  await probe("hub staff order from their own hub's lot", 'HTTP 403', async () =>
    expectStatus(await offer(staff, hubLot, { quantity: 1 }), 403),
  );
  await probe('hub staff accept the order', 'HTTP 200, confirmed', async () => {
    const res = await act(staff, hubOrder, 'accept');
    return {
      pass: res.body.data?.status === 'confirmed',
      actual: `${says(res)} ${res.body.data?.status}`,
    };
  });

  // ── Listing validation ───────────────────────────────────────────────────
  const invalidListings: Array<[string, Record<string, unknown>]> = [
    ['create a listing with quantity 0', { quantity: 0 }],
    [
      'create a listing with a minimum order above its quantity',
      { quantity: 2, minOrderQuantity: 3 },
    ],
    ['create a listing with price 0', { pricePence: 0 }],
    ['create a listing priced beyond a 32-bit integer', { pricePence: 3_000_000_000 }],
  ];
  const validListing: Record<string, unknown> = {
    passportId: '00000000-0000-4000-8000-000000000000',
    pricePence: 100,
    quantity: 1,
    shippingOptions: [{ method: 'collection' }],
  };
  for (const [name, body] of invalidListings) {
    await probe(name, 'HTTP 400', async () =>
      expectStatus(
        await rehearsal.api('POST', '/api/v1/marketplace/listings', {
          token: seller.token,
          body: { ...validListing, ...body },
        }),
        400,
      ),
    );
  }

  // ── Inspection: who may look, who may report, what the public learns ─────
  const inspector = await rehearsal.persona('inspector');
  interface Material {
    id: string;
    productName: string;
    organisationName: string;
    conditionGrade: string | null;
  }
  interface PublicReport {
    source: string;
    inspector: { name: string; role: string } | null;
  }
  const inspectable = await createListedPassport(ctx, seller.token, {
    productName: uniqueName('Rehearsal Probe Inspectable'),
  });
  const materials = (who: Session | null, query = '') =>
    rehearsal.api<{ data: Material[]; total: number }>('GET', `/api/v1/quality/materials${query}`, {
      ...(who ? { token: who.token } : {}),
    });
  const report = (who: Session, passportId: string, body: Record<string, unknown> = {}) =>
    rehearsal.api<{ id: string }>('POST', '/api/v1/quality/reports', {
      token: who.token,
      body: { passportId, overallGrade: 'B', reportNotes: 'Rehearsal probe.', ...body },
    });

  await probe('the materials list without signing in', 'HTTP 401', async () =>
    expectStatus(await materials(null), 401),
  );
  for (const [name, who] of [
    ['a buyer', buyer],
    ['a supplier', seller],
    ['hub staff', staff],
  ] as const) {
    await probe(`${name} reads the materials list`, 'HTTP 403', async () =>
      expectStatus(await materials(who), 403),
    );
    await probe(`${name} files a quality report`, 'HTTP 403', async () =>
      expectStatus(await report(who, inspectable.passportId), 403),
    );
  }
  await probe(
    'an inspector sees materials of more than one organisation',
    'HTTP 200, 2+ organisations',
    async () => {
      const res = await materials(inspector, '?limit=50');
      const holders = new Set((res.body.data?.data ?? []).map((m) => m.organisationName));
      return {
        pass: res.status === 200 && holders.size > 1,
        actual: `${says(res)}, ${holders.size}`,
      };
    },
  );
  await probe("a hub admin sees only the hub's own materials", '1 organisation', async () => {
    const res = await materials(hubAdmin, '?limit=50');
    const holders = new Set((res.body.data?.data ?? []).map((m) => m.organisationName));
    return {
      pass: res.status === 200 && holders.size === 1,
      actual: `${says(res)}, ${holders.size}`,
    };
  });
  await probe("a hub admin reports on another organisation's material", 'HTTP 403', async () =>
    expectStatus(await report(hubAdmin, inspectable.passportId, { overallGrade: 'D' }), 403),
  );
  await probe('a search with SQL wildcards matches literally', '0 found', async () => {
    const res = await materials(inspector, `?q=${encodeURIComponent('%_%')}`);
    return { pass: res.body.data?.total === 0, actual: `${says(res)}, ${res.body.data?.total}` };
  });
  for (const query of ['?limit=500', '?page=0', '?uninspected=maybe']) {
    await probe(`materials list with ${query}`, 'HTTP 400', async () =>
      expectStatus(await materials(inspector, query), 400),
    );
  }
  for (const [name, body] of [
    ['a score of 11', { structuralScore: 11 }],
    ['a grade of E', { overallGrade: 'E' }],
    ['no grade', { overallGrade: undefined, structuralScore: 6 }],
  ] as const) {
    await probe(`a report with ${name}`, 'HTTP 400', async () =>
      expectStatus(await report(inspector, inspectable.passportId, body), 400),
    );
  }
  await probe('a report on a material that does not exist', 'HTTP 404', async () =>
    expectStatus(await report(inspector, '00000000-0000-4000-8000-000000000000'), 404),
  );
  await probe('an inspector reports on it', 'HTTP 201', async () =>
    expectStatus(await report(inspector, inspectable.passportId), 201),
  );
  await probe(
    'the public reports name the inspector and role, and nothing private',
    'independent, no email or user id',
    async () => {
      const res = await rehearsal.api<PublicReport[]>(
        'GET',
        `/api/v1/quality/reports/passport/${inspectable.passportId}`,
      );
      const text = JSON.stringify(res.body.data ?? null);
      const first = res.body.data?.[0];
      const leaks = [/@/, /inspectorId/, new RegExp(inspector.user.id)].filter((p) => p.test(text));
      return {
        pass: first?.source === 'independent' && !!first.inspector?.name && leaks.length === 0,
        actual: `${says(res)} ${first?.source}, ${first?.inspector?.role}, ${leaks.length} leaks`,
      };
    },
  );
  // Once an inspector has graded a material, its seller cannot change the grade.
  const hubMaterial = await createListedPassport(ctx, hubAdmin.token, {
    productName: uniqueName('Rehearsal Probe Hub Material'),
  });
  const gradeOf = async (passportId: string) =>
    (await materials(inspector, `?q=${passportId}`)).body.data?.data[0]?.conditionGrade ?? null;
  await probe(
    "a hub's own check sets the grade of a material nobody has inspected",
    'A',
    async () => {
      const res = await report(hubAdmin, hubMaterial.passportId, { overallGrade: 'A' });
      const grade = await gradeOf(hubMaterial.passportId);
      return { pass: res.status === 201 && grade === 'A', actual: `${says(res)}, grade ${grade}` };
    },
  );
  await probe('an inspector grades it C', 'C', async () => {
    const res = await report(inspector, hubMaterial.passportId, { overallGrade: 'C' });
    const grade = await gradeOf(hubMaterial.passportId);
    return { pass: res.status === 201 && grade === 'C', actual: `${says(res)}, grade ${grade}` };
  });
  await probe(
    "the hub's own check, grade A, after the inspection",
    'recorded (HTTP 201); the grade stays C',
    async () => {
      const res = await report(hubAdmin, hubMaterial.passportId, { overallGrade: 'A' });
      const grade = await gradeOf(hubMaterial.passportId);
      return { pass: res.status === 201 && grade === 'C', actual: `${says(res)}, grade ${grade}` };
    },
  );
  await probe('the hub edits the grade on the passport', 'HTTP 409', async () =>
    expectStatus(
      await rehearsal.api('PATCH', `/api/v1/passports/${hubMaterial.passportId}`, {
        token: hubAdmin.token,
        body: { conditionGrade: 'A' },
      }),
      409,
    ),
  );
  await probe('the platform admin re-grades it B', 'B', async () => {
    const res = await report(admin, hubMaterial.passportId, { overallGrade: 'B' });
    const grade = await gradeOf(hubMaterial.passportId);
    return { pass: res.status === 201 && grade === 'B', actual: `${says(res)}, grade ${grade}` };
  });

  // Flagging a report is for whoever holds the material.
  const reportsOn = async (passportId: string) =>
    (
      await rehearsal.api<Array<{ id: string }>>(
        'GET',
        `/api/v1/quality/reports/passport/${passportId}`,
      )
    ).body.data ?? [];
  const flag = (who: Session, reportId: string) =>
    rehearsal.api('POST', `/api/v1/quality/reports/${reportId}/dispute`, { token: who.token });
  const hubReport = (await reportsOn(hubMaterial.passportId))[0]?.id ?? '';
  for (const [name, who] of [
    ['a buyer with no part in it', buyer],
    ['a seller of another organisation', seller],
  ] as const) {
    await probe(`${name} flags a report`, 'HTTP 403', async () =>
      expectStatus(await flag(who, hubReport), 403),
    );
  }
  await probe('the hub that holds the material flags a report on it', 'HTTP 200', async () =>
    expectStatus(await flag(hubAdmin, hubReport), 200),
  );
  await probe('it flags the same report again', 'HTTP 409', async () =>
    expectStatus(await flag(hubAdmin, hubReport), 409),
  );

  await probe('once inspected, it leaves the not-yet-inspected queue', '0 found', async () => {
    const res = await materials(inspector, `?uninspected=true&q=${inspectable.passportId}`);
    return { pass: res.body.data?.total === 0, actual: `${says(res)}, ${res.body.data?.total}` };
  });

  await ctx.dispose();
}
