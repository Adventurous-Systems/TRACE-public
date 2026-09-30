import { describe, expect, it } from 'vitest';
import { passportIdFrom } from './passport-link';

const ID = '5d13f484-f5ff-448c-9bb9-76960a1f2915';

describe('passportIdFrom', () => {
  it('reads the id from a Digital Link (what the QR code encodes)', () => {
    expect(passportIdFrom(`https://demo.trace.adventurous.systems/passport/${ID}`)).toBe(ID);
    expect(passportIdFrom(`http://localhost:3000/passport/${ID}?ref=label`)).toBe(ID);
  });

  it('accepts a bare id, trimmed', () => {
    expect(passportIdFrom(`  ${ID}  `)).toBe(ID);
  });

  it('finds a passport UUID inside other text', () => {
    expect(passportIdFrom(`passport: ${ID.toUpperCase()}`)).toBe(ID);
  });

  it('rejects empty or unusable input', () => {
    expect(passportIdFrom('   ')).toBeNull();
    expect(passportIdFrom('not a passport at all!')).toBeNull();
  });
});
