/**
 * Passport ids are UUIDs in the database and bytes32 on chain (left-padded).
 * One copy of the conversion, shared by the worker, verification and the
 * transaction explorer.
 */

export function uuidToBytes32(uuid: string): string {
  return '0x' + uuid.replace(/-/g, '').padStart(64, '0');
}

export function bytes32ToUuid(value: string): string {
  const hex = value.replace(/^0x/, '').slice(-32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
