import { expect, type APIRequestContext } from '@playwright/test';
import { API_URL } from './accounts';
import { PNG_1x1 } from './test-helpers';

export async function apiLogin(
  ctx: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await ctx.post(`${API_URL}/api/v1/auth/login`, { data: { email, password } });
  expect(res.ok(), `API login ${email} (HTTP ${res.status()})`).toBeTruthy();
  return (await res.json()).data.token;
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
  opts: { productName: string; pricePence?: number },
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
      quantity: 1,
      shippingOptions: [{ method: 'collection' }],
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
