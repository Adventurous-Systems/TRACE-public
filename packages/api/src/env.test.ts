import { describe, expect, it } from 'vitest';
import { PHOTO_UPLOAD_MAX_BYTES } from '@trace/core';
import { envSchema } from './env.js';

const required = {
  JWT_SECRET: 'test-secret-min-16-chars-long',
  DATABASE_URL: 'postgresql://trace:trace@localhost:5432/trace_test',
};

const flags = [
  'ANCHOR_WORKER_ENABLED',
  'FEE_DELEGATION_REQUIRED',
  'DEMO_SIMULATE_ANCHOR',
  'STORAGE_SERVE',
] as const;

describe('environment validation across the Zod security upgrade', () => {
  it('defaults the boolean flags and storage settings when they are not set', () => {
    expect(envSchema.parse(required)).toMatchObject({
      ANCHOR_WORKER_ENABLED: true,
      FEE_DELEGATION_REQUIRED: false,
      DEMO_SIMULATE_ANCHOR: false,
      STORAGE_SERVE: false,
      STORAGE_DIR: '/var/lib/trace/objects',
      UPLOAD_MAX_BYTES: PHOTO_UPLOAD_MAX_BYTES,
    });
  });

  it.each(flags)('reads %s set to true or false', (flag) => {
    expect(envSchema.parse({ ...required, [flag]: 'true' })[flag]).toBe(true);
    expect(envSchema.parse({ ...required, [flag]: 'false' })[flag]).toBe(false);
  });

  it.each(flags)('keeps an empty %s as false', (flag) => {
    expect(envSchema.parse({ ...required, [flag]: '' })[flag]).toBe(false);
  });

  it('falls back to the defaults for empty storage settings', () => {
    const parsed = envSchema.parse({ ...required, STORAGE_DIR: '', UPLOAD_MAX_BYTES: '' });
    expect(parsed.STORAGE_DIR).toBe('/var/lib/trace/objects');
    expect(parsed.UPLOAD_MAX_BYTES).toBe(PHOTO_UPLOAD_MAX_BYTES);
  });

  it('rejects a missing JWT secret', () => {
    const result = envSchema.safeParse({ DATABASE_URL: required.DATABASE_URL });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('JWT_SECRET');
    }
  });
});
