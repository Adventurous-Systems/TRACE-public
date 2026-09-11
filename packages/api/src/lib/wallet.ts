import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { Wallet } from 'ethers';
import { db, organisations, users } from '@trace/db';
import { env } from '../env.js';

const ENCRYPTION_VERSION = 'v1';

export interface CustodialWallet {
  address: string;
  privateKey: string;
}

function getEncryptionKey(secret: string | undefined): Buffer {
  if (!secret) {
    throw new Error('WALLET_ENCRYPTION_KEY is required for custodial org wallets');
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptPrivateKeyWithSecret(privateKey: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString('hex'),
    tag.toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

export function decryptPrivateKeyWithSecret(encrypted: string, secret: string): string {
  const [version, ivHex, tagHex, ciphertextHex] = encrypted.split(':');
  if (version !== ENCRYPTION_VERSION || !ivHex || !tagHex || !ciphertextHex) {
    throw new Error('Unsupported encrypted wallet payload');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(secret),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

export function encryptPrivateKey(privateKey: string): string {
  return encryptPrivateKeyWithSecret(privateKey, env.WALLET_ENCRYPTION_KEY ?? '');
}

export function decryptPrivateKey(encrypted: string): string {
  return decryptPrivateKeyWithSecret(encrypted, env.WALLET_ENCRYPTION_KEY ?? '');
}

export function generateCustodialWallet(): CustodialWallet {
  const wallet = Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
}

export async function ensureOrganisationWallet(organisationId: string): Promise<CustodialWallet> {
  const organisation = await db.query.organisations.findFirst({
    where: eq(organisations.id, organisationId),
  });

  if (!organisation) {
    throw new Error(`Organisation ${organisationId} not found`);
  }

  if (organisation.blockchainPrivateKeyEnc) {
    const privateKey = decryptPrivateKey(organisation.blockchainPrivateKeyEnc);
    const address = organisation.blockchainAddress ?? new Wallet(privateKey).address;
    if (!organisation.blockchainAddress) {
      await db
        .update(organisations)
        .set({ blockchainAddress: address, updatedAt: new Date() })
        .where(eq(organisations.id, organisationId));
    }
    return { address, privateKey };
  }

  const wallet = generateCustodialWallet();
  await db.transaction(async (tx) => {
    await tx
      .update(organisations)
      .set({
        blockchainAddress: wallet.address,
        blockchainPrivateKeyEnc: encryptPrivateKey(wallet.privateKey),
        updatedAt: new Date(),
      })
      .where(eq(organisations.id, organisationId));

    await tx
      .update(users)
      .set({ blockchainAddress: wallet.address })
      .where(eq(users.organisationId, organisationId));
  });

  return wallet;
}

export async function maybeEnsureOrganisationWallet(
  organisationId: string,
): Promise<CustodialWallet | null> {
  if (!env.WALLET_ENCRYPTION_KEY) return null;
  return ensureOrganisationWallet(organisationId);
}
