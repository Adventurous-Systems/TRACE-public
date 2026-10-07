/**
 * Copy the files a database refers to into the plain-file object store, and
 * record each in stored_objects. Used once when a deployment moves off MinIO,
 * and again after any rollback window in which the previous release stored
 * new files in MinIO. Safe to repeat: a file already on disk is not fetched
 * again, only recorded if its ledger row is missing.
 */
import type { FileObjectStore } from '../../src/object-store.js';
import { contentTypeFor, sha256Hex } from '../../src/object-store.js';

/** One place the database points at a stored file. */
export interface StoredReference {
  url: string;
  passportId: string;
  organisationId: string;
  /** The passport is curated catalogue data (customAttributes.seedSource). */
  seeded: boolean;
}

export interface LedgerRecord {
  bucket: string;
  key: string;
  kind: 'photo' | 'qr' | 'catalogue';
  organisationId: string;
  passportId: string;
  bytes: number;
  sha256: string;
  contentType: string;
}

export interface Fetched {
  status: number;
  body: Buffer;
  contentType: string | null;
  contentLength: number | null;
}

export interface ImportReport {
  /** Distinct files the database refers to. */
  referenced: number;
  fetched: number;
  alreadyOnDisk: number;
  /** URLs that are not under this store's public base; left as they are. */
  foreign: string[];
  failed: { url: string; reason: string }[];
  records: LedgerRecord[];
}

export function kindOf(key: string, ref: StoredReference): LedgerRecord['kind'] {
  if (/\/qr\.png$/.test(key)) return 'qr';
  return ref.seeded ? 'catalogue' : 'photo';
}

export async function importObjects(options: {
  refs: StoredReference[];
  store: FileObjectStore;
  /** Where to fetch a file that isn't on disk yet. */
  sourceUrl: (ref: StoredReference, bucket: string, key: string) => string;
  fetchObject: (url: string) => Promise<Fetched>;
  dryRun: boolean;
}): Promise<ImportReport> {
  const { store } = options;
  const report: ImportReport = {
    referenced: 0,
    fetched: 0,
    alreadyOnDisk: 0,
    foreign: [],
    failed: [],
    records: [],
  };

  // First reference wins: a report photo is a copy of its passport's URL.
  const byKey = new Map<string, { ref: StoredReference; bucket: string; key: string }>();
  for (const ref of options.refs) {
    const location = store.locate(ref.url);
    if (!location) {
      if (!report.foreign.includes(ref.url)) report.foreign.push(ref.url);
      continue;
    }
    const id = `${location.bucket}/${location.key}`;
    if (!byKey.has(id)) byKey.set(id, { ref, ...location });
  }
  report.referenced = byKey.size;

  for (const { ref, bucket, key } of byKey.values()) {
    const record = (body: Buffer, contentType: string): LedgerRecord => ({
      bucket,
      key,
      kind: kindOf(key, ref),
      organisationId: ref.organisationId,
      passportId: ref.passportId,
      bytes: body.length,
      sha256: sha256Hex(body),
      contentType,
    });

    if (await store.exists(bucket, key)) {
      report.alreadyOnDisk += 1;
      report.records.push(record(await store.read(bucket, key), contentTypeFor(key)));
      continue;
    }

    const source = options.sourceUrl(ref, bucket, key);
    let fetched: Fetched;
    try {
      fetched = await options.fetchObject(source);
    } catch (error) {
      report.failed.push({ url: ref.url, reason: `fetch failed: ${(error as Error).message}` });
      continue;
    }
    if (fetched.status !== 200) {
      report.failed.push({ url: ref.url, reason: `HTTP ${fetched.status} from ${source}` });
      continue;
    }
    if (fetched.contentLength !== null && fetched.contentLength !== fetched.body.length) {
      report.failed.push({
        url: ref.url,
        reason: `size ${fetched.body.length} does not match Content-Length ${fetched.contentLength}`,
      });
      continue;
    }
    const contentType = fetched.contentType?.split(';')[0]?.trim() || contentTypeFor(key);
    if (!options.dryRun) await store.put(bucket, key, fetched.body, contentType);
    report.fetched += 1;
    report.records.push(record(fetched.body, contentType));
  }
  return report;
}
