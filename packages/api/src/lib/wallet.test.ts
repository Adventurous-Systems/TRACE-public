import { describe, expect, it } from 'vitest';
import {
  decryptPrivateKeyWithSecret,
  encryptPrivateKeyWithSecret,
  generateCustodialWallet,
} from './wallet.js';

describe('custodial wallet helpers', () => {
  it('generates an address/private-key pair without exposing encrypted payloads', () => {
    const wallet = generateCustodialWallet();
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(wallet.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('encrypts and decrypts private keys with AES-GCM payloads', () => {
    const wallet = generateCustodialWallet();
    const secret = 'test-wallet-encryption-secret';
    const encrypted = encryptPrivateKeyWithSecret(wallet.privateKey, secret);

    expect(encrypted).not.toContain(wallet.privateKey.slice(2));
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(decryptPrivateKeyWithSecret(encrypted, secret)).toBe(wallet.privateKey);
  });

  it('rejects decryption with the wrong secret', () => {
    const wallet = generateCustodialWallet();
    const encrypted = encryptPrivateKeyWithSecret(wallet.privateKey, 'correct-secret');

    expect(() => decryptPrivateKeyWithSecret(encrypted, 'wrong-secret')).toThrow();
  });
});
