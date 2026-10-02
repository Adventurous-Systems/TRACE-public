/**
 * Stakeholder journeys through the running demo, in the order a real day would
 * produce them: a visitor looks around, buyers order, the hub answers, the
 * buyers follow up, and the other roles do their work.
 *
 * Each step notes what the page said, so the report can be read without
 * opening every screenshot. They use the curated catalogue, so run them on a
 * freshly restored stack (`pnpm stack restore`).
 */
import { throwawayPassword, type Journey, type Rehearsal } from './harness';

const KBRIQ = 'K-BRIQ';
const STAIRCASE = 'Reclaimed Prefabricated Staircase';
const BLOCKS = 'Reclaimed Aerated Concrete Blocks';
const SISALWOOL = 'Sisalwool 100';
const BRICKS = 'Reclaimed Facing Bricks';

interface ListingSummary {
  id: string;
  passportId: string;
  passport: { productName: string };
}

async function curated(rehearsal: Rehearsal, name: string): Promise<ListingSummary> {
  const res = await rehearsal.api<{ data: ListingSummary[] } | ListingSummary[]>(
    'GET',
    '/api/v1/marketplace/listings?limit=50',
  );
  const payload = res.body.data;
  const listings = Array.isArray(payload) ? payload : (payload?.data ?? []);
  const found = listings.find((l) => l.passport.productName.startsWith(name));
  if (!found) throw new Error(`no active curated listing for "${name}" (run: pnpm stack restore)`);
  return found;
}

/** What the order form shows after the quantity field is set to `value`. */
async function tryQuantity(journey: Journey, value: string): Promise<string> {
  const field = journey.page.getByLabel('Quantity');
  await field.fill(value);
  await journey.page.waitForTimeout(250);
  const problem = await journey.page.locator('#order-quantity ~ p').first().textContent();
  const disabled = await journey.page
    .getByRole('button', { name: /order at asking price/i })
    .isDisabled();
  return `quantity "${value}" → "${problem?.trim()}", button ${disabled ? 'disabled' : 'enabled'}`;
}

async function placeOrder(journey: Journey, listingId: string, quantity: number): Promise<string> {
  await journey.goto(`/marketplace/${listingId}`);
  await journey.page.getByLabel('Quantity').fill(String(quantity));
  const total = await journey.page.locator('#order-quantity ~ p').first().textContent();
  await journey.page.getByRole('button', { name: /order at asking price/i }).click();
  await journey.page
    .getByText(/order placed/i)
    .first()
    .waitFor({ timeout: 10_000 });
  return `ordered ${quantity}: ${total?.trim()}`;
}

const order = (journey: Journey, product: string) =>
  journey.page.getByRole('listitem').filter({ hasText: product }).first();

async function ordersSummary(journey: Journey): Promise<string> {
  await journey.goto('/transactions');
  const rows = await journey.page.getByRole('listitem').allInnerTexts();
  return rows.map((row) => row.split('\n').slice(0, 5).join(' · ')).join(' || ') || 'no orders';
}

export async function runJourneys(rehearsal: Rehearsal): Promise<void> {
  const kbriq = await curated(rehearsal, KBRIQ);
  const staircase = await curated(rehearsal, STAIRCASE);
  const blocks = await curated(rehearsal, BLOCKS);
  const sisalwool = await curated(rehearsal, SISALWOOL);
  const bricks = await curated(rehearsal, BRICKS);
  const nowhere = '00000000-0000-4000-8000-000000000000';

  // ── 1. An anonymous visitor ──────────────────────────────────────────────
  await rehearsal.journey('1 visitor', null, async (j) => {
    await j.step('landing', async () => {
      await j.goto('/');
      return (await j.text(/TRACE issues/)) ?? 'no headline found';
    });
    await j.step('marketplace', async () => {
      await j.goto('/marketplace');
      return `${await j.text(/Reusing everything|CO₂e saved/)} · ${await j.text(/\d+ listings?/)}`;
    });
    await j.step('filter by category', async () => {
      const select = j.page.locator('select').first();
      const options = await select.locator('option').allInnerTexts();
      await select.selectOption({ index: 1 });
      await j.page.waitForLoadState('networkidle');
      return `options: ${options.join(', ')} → ${await j.text(/\d+ listings?/)}`;
    });
    await j.step('search with no matches', async () => {
      await j.goto('/marketplace');
      await j.page.getByPlaceholder(/search materials/i).fill('zzzz-no-such-material');
      await j.page.waitForTimeout(1200);
      return (await j.text(/no (results|materials|listings)/i)) ?? 'no empty-state text found';
    });
    await j.step('listing (logged out)', async () => {
      await j.goto(`/marketplace/${kbriq.id}`);
      const cta = await j.page.getByRole('link', { name: /sign up to buy/i }).count();
      const form = await j.page.getByLabel('Quantity').count();
      return `price "${await j.page.locator('p.text-3xl').last().innerText()}", sign-up link: ${cta}, order form: ${form}`;
    });
    await j.step('passport', async () => {
      await j.page.getByText('View full material passport').click();
      await j.page.waitForLoadState('networkidle');
      return (await j.text(/Blockchain verified|Pending verification|Trust layer prepared/)) ?? '';
    });
    await j.step('verify integrity', async () => {
      await j.page.getByRole('button', { name: /verify integrity/i }).click();
      await j.page.waitForTimeout(2500);
      return (await j.text(/Untampered|Mismatch|still being anchored|Couldn/)) ?? 'no result shown';
    });
    await j.step('check on chain now', async () => {
      await j.page.getByRole('button', { name: /check on chain now/i }).click();
      await j.page.waitForTimeout(2500);
      return (
        (await j.text(/Confirmed just now|different fingerprint|reach the chain/)) ?? 'no result'
      );
    });
    await j.step('explorer', async () => {
      const [popup] = await Promise.all([
        j.context.waitForEvent('page', { timeout: 4000 }).catch(() => null),
        j.page.getByText('View on explorer').click(),
      ]);
      const target = popup ?? j.page;
      await target.waitForLoadState('networkidle');
      const text = (await target.locator('main, body').first().innerText()).slice(0, 160);
      if (popup) await popup.close();
      else await j.page.goBack();
      return `${popup ? 'new tab' : 'same tab'}: ${text.replace(/\s+/g, ' ')}`;
    });
    await j.step('scan: paste a passport link', async () => {
      await j.goto('/scan');
      await j.page
        .locator('input')
        .first()
        .fill(`${rehearsal.baseUrl}/passport/${kbriq.passportId}`);
      await j.page.getByRole('button', { name: /^go$/i }).click();
      await j.page.waitForLoadState('networkidle');
      return `landed on ${j.page.url().replace(rehearsal.baseUrl, '')}`;
    });
    await j.step(
      'unknown passport',
      async () => {
        await j.goto(`/passport/${nowhere}`);
        return (await j.page.locator('main, body').first().innerText()).slice(0, 120);
      },
      { expectIssues: /HTTP 404|404/ },
    );
    await j.step(
      'unknown listing',
      async () => {
        await j.goto(`/marketplace/${nowhere}`);
        return (await j.page.locator('main, body').first().innerText()).slice(0, 120);
      },
      { expectIssues: /HTTP 404|404/ },
    );
    await j.step('orders while logged out', async () => {
      await j.goto('/transactions');
      return `landed on ${j.page.url().replace(rehearsal.baseUrl, '')}`;
    });
  });

  // ── 2. A visitor signs up and orders ─────────────────────────────────────
  await rehearsal.journey('2 new buyer', null, async (j) => {
    const email = `rehearsal.visitor.${Date.now()}@example.com`;
    const password = throwawayPassword();
    await j.step('register', async () => {
      await j.goto(`/register?next=${encodeURIComponent(`/marketplace/${sisalwool.id}`)}`);
      for (const input of await j.page.locator('input').all()) {
        const type = await input.getAttribute('type');
        const name = `${await input.getAttribute('name')} ${await input.getAttribute('id')}`;
        if (type === 'email') await input.fill(email);
        else if (type === 'password') await input.fill(password);
        else if (type === 'checkbox') await input.check();
        else if (/name/i.test(name) || type === 'text') await input.fill('Rehearsal Visitor');
      }
      await j.page.locator('button[type=submit]').click();
      await j.page.waitForLoadState('networkidle');
      return `${email} → landed on ${j.page.url().replace(rehearsal.baseUrl, '')}`;
    });
    await j.step('order 3 packs', () => placeOrder(j, sisalwool.id, 3));
    await j.step('orders', () => ordersSummary(j));
    await j.step('seller pages are closed to a visitor', async () => {
      await j.goto('/listings/new');
      return `landed on ${j.page.url().replace(rehearsal.baseUrl, '')}: ${(await j.page.locator('main, body').first().innerText()).slice(0, 100)}`;
    });
  });

  // ── 3. The demo buyer orders, and tries the limits ───────────────────────
  await rehearsal.journey('3 buyer orders', 'buyer', async (j) => {
    await j.step('quantity limits on the order form', async () => {
      await j.goto(`/marketplace/${kbriq.id}`);
      const start = await j.page.getByLabel('Quantity').inputValue();
      const tries = [];
      for (const value of ['50', '', '2.5', '-3', '0', '999999', '250']) {
        tries.push(await tryQuantity(j, value));
      }
      return `starts at ${start}; ${tries.join('; ')}`;
    });
    await j.step('order 250 bricks', () => placeOrder(j, kbriq.id, 250));
    await j.step('listing after the order', async () => {
      await j.page.reload({ waitUntil: 'networkidle' });
      return (await j.page.locator('dl').innerText()).replace(/\s+/g, ' ').slice(0, 260);
    });
    await j.step('order 5 blocks', () => placeOrder(j, blocks.id, 5));
    await j.step('order both staircases (the whole lot)', () => placeOrder(j, staircase.id, 2));
    await j.step('a fully ordered lot', async () => {
      await j.page.reload({ waitUntil: 'networkidle' });
      return (await j.text(/This listing is .*/)) ?? 'the order form is still shown';
    });
    await j.step('marketplace without the staircase', async () => {
      await j.goto('/marketplace');
      const shown = await j.page.getByText(STAIRCASE).count();
      return `${await j.text(/Reusing everything/)} · staircase shown: ${shown}`;
    });
    await j.step('orders', () => ordersSummary(j));
  });

  // ── 4. The hub (the seller) answers ──────────────────────────────────────
  await rehearsal.journey('4 hub admin', 'hubAdmin', async (j) => {
    await j.step('dashboard', async () => {
      await j.goto('/dashboard');
      return (await j.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200);
    });
    await j.step('incoming orders', () => ordersSummary(j));
    await j.step('accept the K-BRIQ order', async () => {
      await order(j, KBRIQ)
        .getByRole('button', { name: /accept order/i })
        .click();
      await order(j, KBRIQ).getByText('Accepted').waitFor({ timeout: 8000 });
      return (await order(j, KBRIQ).innerText()).replace(/\s+/g, ' ');
    });
    await j.step('accept the blocks order', async () => {
      await order(j, BLOCKS)
        .getByRole('button', { name: /accept order/i })
        .click();
      await order(j, BLOCKS).getByText('Accepted').waitFor({ timeout: 8000 });
    });
    await j.step('reject the staircase order', async () => {
      await order(j, STAIRCASE)
        .getByRole('button', { name: /^reject$/i })
        .click();
      await order(j, STAIRCASE).getByText('Cancelled').waitFor({ timeout: 8000 });
      return (await order(j, STAIRCASE).innerText()).replace(/\s+/g, ' ');
    });
    await j.step('listings', async () => {
      await j.goto('/listings');
      return (await j.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 300);
    });
    await j.step('passports', async () => {
      await j.goto('/passports');
      return `${await j.page.locator('a[href^="/passports/"]').count()} passport links`;
    });
    await j.step('a passport (seller view)', async () => {
      await j.goto(`/passports/${kbriq.passportId}`);
      return (await j.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200);
    });
    await j.step('new listing form', async () => {
      await j.goto('/listings/new');
      return (await j.page.locator('label').allInnerTexts()).join(' | ');
    });
  });

  // ── 5. The buyer follows up ──────────────────────────────────────────────
  await rehearsal.journey('5 buyer follows up', 'buyer', async (j) => {
    await j.step('orders after the hub answered', () => ordersSummary(j));
    await j.step('confirm delivery of the bricks', async () => {
      await order(j, KBRIQ)
        .getByRole('button', { name: /confirm delivery/i })
        .click();
      await order(j, KBRIQ).getByText('Completed').waitFor({ timeout: 8000 });
      return (await order(j, KBRIQ).innerText()).replace(/\s+/g, ' ');
    });
    await j.step('report a problem with the blocks', async () => {
      await order(j, BLOCKS)
        .getByRole('button', { name: /report a problem/i })
        .click();
      await order(j, BLOCKS).getByText('Problem flagged').waitFor({ timeout: 8000 });
      return (await order(j, BLOCKS).innerText()).replace(/\s+/g, ' ');
    });
    await j.step('the staircase is back on sale', async () => {
      await j.goto(`/marketplace/${staircase.id}`);
      return (await j.page.locator('dl').innerText()).replace(/\s+/g, ' ').slice(0, 200);
    });
    await j.step('the K-BRIQ passport after a part sale', async () => {
      await j.goto(`/passport/${kbriq.passportId}`);
      return (await j.text(/Blockchain verified|Pending verification|Verification failed/)) ?? '';
    });
  });

  // ── 6. The platform admin ────────────────────────────────────────────────
  await rehearsal.journey('6 platform admin', 'platformAdmin', async (j) => {
    for (const route of [
      '/dashboard',
      '/admin/access-requests',
      '/admin/activity',
      '/admin/feedback',
    ]) {
      await j.step(route, async () => {
        await j.goto(route);
        return (await j.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160);
      });
    }
    await j.step('orders: can the admin see the flagged order?', () => ordersSummary(j));
  });

  // ── 7. The inspector re-grades a material ────────────────────────────────
  await rehearsal.journey('7 inspector', 'inspector', async (j) => {
    await j.step('dashboard', async () => {
      await j.goto('/dashboard');
      return (await j.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200);
    });
    await j.step('quality reports', async () => {
      await j.goto('/quality');
      return (await j.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200);
    });
    await j.step('file a report that changes the grade to C', async () => {
      await j.goto(`/quality/new?passportId=${bricks.passportId}`);
      await j.page.getByRole('button', { name: /^C\s*Fair$/ }).click();
      await j.page.locator('textarea').first().fill('Rehearsal: chipped arrises on about a third.');
      await j.page.getByRole('button', { name: /submit report/i }).click();
      await j.page.waitForLoadState('networkidle');
      return `landed on ${j.page.url().replace(rehearsal.baseUrl, '')}`;
    });
    for (const wait of [0, 8, 20]) {
      await j.step(`the public passport ${wait}s after the report`, async () => {
        if (wait) await j.page.waitForTimeout(wait === 8 ? 8000 : 12000);
        await j.goto(`/passport/${bricks.passportId}`);
        const badge = await j.text(/Blockchain verified|Pending verification|Verification failed/);
        const grade = await j.text(/Grade [A-D] —/);
        await j.page.getByRole('button', { name: /verify integrity/i }).click();
        await j.page.waitForTimeout(2000);
        const integrity = await j.text(/Untampered|Mismatch|still being anchored|Couldn/);
        return `badge "${badge}", ${grade}, integrity "${integrity}"`;
      });
    }
  });

  // ── 8. Hub staff, and a supplier ─────────────────────────────────────────
  await rehearsal.journey('8 hub staff', 'hubStaff', async (j) => {
    for (const route of [
      '/dashboard',
      '/transactions',
      '/listings',
      '/passports',
      '/passports/new',
    ]) {
      await j.step(route, async () => {
        await j.goto(route);
        return (await j.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160);
      });
    }
  });
  await rehearsal.journey('9 supplier', 'supplier', async (j) => {
    for (const route of ['/dashboard', '/passports', '/listings', '/transactions']) {
      await j.step(route, async () => {
        await j.goto(route);
        return (await j.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160);
      });
    }
  });

  // ── 10. A buyer on a phone ───────────────────────────────────────────────
  await rehearsal.journey(
    '10 buyer on a phone',
    'buyer',
    async (j) => {
      for (const [label, route] of [
        ['marketplace', '/marketplace'],
        ['listing with the order form', `/marketplace/${kbriq.id}`],
        ['orders', '/transactions'],
        ['passport', `/passport/${kbriq.passportId}`],
      ] as const) {
        await j.step(label, async () => {
          await j.goto(route);
          await j.checkOverflow(label);
        });
      }
    },
    { mobile: true },
  );
}
