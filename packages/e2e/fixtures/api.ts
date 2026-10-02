import { readFileSync } from 'node:fs';
import { expect, type APIRequestContext } from '@playwright/test';
import { API_URL, statePath, type Role } from './accounts';
import { PNG_1x1 } from './test-helpers';

/**
 * The API token of a persona, from the session global-setup minted for it.
 * Tests use this instead of signing in again: sign-ins are limited to 10 a
 * minute per address, and the suite passed that once it had six personas.
 */
export function sessionToken(role: Role): string {
  const state = JSON.parse(readFileSync(statePath(role), 'utf8')) as {
    cookies: Array<{ name: string; value: string }>;
  };
  const token = state.cookies.find((cookie) => cookie.name === 'trace_auth')?.value;
  if (!token) throw new Error(`no saved session for "${role}"; did global-setup run?`);
  return token;
}

export interface ListedPassport {
  passportId: string;
  listingId: string;
}

/**
 * Creates a passport, attaches a photo, and publishes a listing — all via the
 * API. Used to seed a deterministic, publicly-visible listing for specs that
 * test the buyer/public side without driving the seller UI.
 */
export async function createListedPassport(
  ctx: APIRequestContext,
  token: string,
  opts: {
    productName: string;
    pricePence?: number;
    quantity?: number;
    minOrderQuantity?: number;
    expiresAt?: string;
  },
): Promise<ListedPassport> {
  const headers = { Authorization: `Bearer ${token}` };

  const pRes = await ctx.post(`${API_URL}/api/v1/passports`, {
    headers,
    data: { productName: opts.productName, categoryL1: 'masonry' },
  });
  expect(pRes.ok(), `create passport (HTTP ${pRes.status()})`).toBeTruthy();
  const passportId: string = (await pRes.json()).data.id;

  const photoRes = await ctx.post(`${API_URL}/api/v1/passports/${passportId}/photos`, {
    headers,
    multipart: { file: { name: 'photo.png', mimeType: 'image/png', buffer: PNG_1x1 } },
  });
  expect(photoRes.ok(), `upload photo (HTTP ${photoRes.status()})`).toBeTruthy();

  const lRes = await ctx.post(`${API_URL}/api/v1/marketplace/listings`, {
    headers,
    data: {
      passportId,
      pricePence: opts.pricePence ?? 12500,
      currency: 'GBP',
      quantity: opts.quantity ?? 1,
      minOrderQuantity: opts.minOrderQuantity ?? 1,
      shippingOptions: [{ method: 'collection' }],
      ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    },
  });
  expect(lRes.ok(), `create listing (HTTP ${lRes.status()})`).toBeTruthy();
  const listingId: string = (await lRes.json()).data.id;

  return { passportId, listingId };
}

/** Creates a passport with NO photo (for the listing-guard test). Returns its id. */
export async function createPassportNoPhoto(
  ctx: APIRequestContext,
  token: string,
  productName: string,
): Promise<string> {
  const res = await ctx.post(`${API_URL}/api/v1/passports`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { productName, categoryL1: 'masonry' },
  });
  expect(res.ok(), `create passport (HTTP ${res.status()})`).toBeTruthy();
  return (await res.json()).data.id;
}
