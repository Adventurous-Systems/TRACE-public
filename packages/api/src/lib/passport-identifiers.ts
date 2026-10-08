/**
 * A passport's public identifiers: its Digital Link (the public passport URL
 * a scan resolves to) and a QR code image of that link.
 *
 * createPassport issues them when a passport is created through the API. The
 * seed/replenish/restore scripts insert rows directly and cannot generate QR
 * images (the operations image has no QR library), so their passports start
 * without identifiers and the anchor worker's sweep backfills them here.
 *
 * Neither field is part of the canonical fingerprint (@trace/db
 * passport-hash), so issuing them never invalidates an anchor.
 */
import QRCode from 'qrcode';
import { and, eq, isNull, or } from 'drizzle-orm';
import { db, materialPassports, type MaterialPassport } from '@trace/db';
import { env } from '../env.js';
import { storeObject } from './storage.js';

export function passportPublicUrl(passportId: string): string {
  return `${env.WEB_URL}/passport/${passportId}`;
}

/**
 * Generate the QR image, upload it, and store both identifiers on the
 * passport. The QR is skipped under NODE_ENV=test (no object storage there),
 * matching createPassport.
 */
export async function issuePassportIdentifiers(passportId: string): Promise<MaterialPassport> {
  const digitalLinkUri = passportPublicUrl(passportId);
  let qrCodeUrl: string | null = null;

  if (env.NODE_ENV !== 'test') {
    const qrBuffer = await QRCode.toBuffer(digitalLinkUri, {
      type: 'png',
      width: 400,
      margin: 2,
      errorCorrectionLevel: 'H',
    });
    qrCodeUrl = await storeObject({
      key: `passports/${passportId}/qr.png`,
      buffer: qrBuffer,
      contentType: 'image/png',
      kind: 'qr',
      organisationId: null,
      passportId,
    });
  }

  const [updated] = await db
    .update(materialPassports)
    .set({ digitalLinkUri, qrCodeUrl, updatedAt: new Date() })
    .where(eq(materialPassports.id, passportId))
    .returning();
  if (!updated) throw new Error(`Passport ${passportId} not found`);
  return updated;
}

/**
 * Passports still missing a Digital Link or (outside tests) a QR image,
 * oldest first.
 */
export async function findPassportsMissingIdentifiers(limit: number) {
  const missing =
    env.NODE_ENV === 'test'
      ? isNull(materialPassports.digitalLinkUri)
      : or(isNull(materialPassports.digitalLinkUri), isNull(materialPassports.qrCodeUrl));
  return db
    .select({ id: materialPassports.id })
    .from(materialPassports)
    .where(and(missing))
    .orderBy(materialPassports.createdAt)
    .limit(limit);
}
