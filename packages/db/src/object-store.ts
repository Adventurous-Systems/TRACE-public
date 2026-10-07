/**
 * Object storage as plain files: `<root>/<bucket>/<key>`, served read-only by
 * nginx at `<publicBaseUrl>/<bucket>/<key>`. It replaced MinIO in R4; the URL
 * shape is MinIO's, so URLs stored before the change still resolve.
 *
 * Files are write-once. A key that exists is never overwritten: the same
 * bytes again are accepted (a retried write), different bytes are refused.
 * That is what lets the nightly backup hard-link snapshots instead of copying
 * them (ops/backup_objects.sh).
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, link, mkdir, readFile, statfs, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface StoredFile {
  bucket: string;
  key: string;
  url: string;
  bytes: number;
  sha256: string;
  contentType: string;
  /** False when the same bytes were already stored under this key. */
  created: boolean;
}

export class ObjectConflictError extends Error {
  constructor(bucket: string, key: string) {
    super(`Object ${bucket}/${key} already exists with different content`);
    this.name = 'ObjectConflictError';
  }
}

// A bucket or key segment: no dot-files, no traversal, no empty segments.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Partly written files live here, on the same filesystem, until linked into place.
const INCOMING = '.incoming';

function checkLocation(bucket: string, key: string): void {
  const parts = [bucket, ...key.split('/')];
  if (!SEGMENT.test(bucket) || key.length === 0 || parts.some((p) => !SEGMENT.test(p))) {
    throw new Error(`Invalid object location: ${bucket}/${key}`);
  }
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export interface FileObjectStore {
  readonly root: string;
  /** Store a buffer under bucket/key, write-once. */
  put(bucket: string, key: string, buffer: Buffer, contentType: string): Promise<StoredFile>;
  exists(bucket: string, key: string): Promise<boolean>;
  read(bucket: string, key: string): Promise<Buffer>;
  urlFor(bucket: string, key: string): string;
  /** The bucket and key a public URL points at, or null if it is not one of ours. */
  locate(url: string): { bucket: string; key: string } | null;
  /** Bytes free on the filesystem that holds the store. */
  freeBytes(): Promise<number>;
  /** Throws unless the root exists and can be written. */
  checkWritable(): Promise<void>;
}

export function createFileObjectStore(options: {
  root: string;
  publicBaseUrl: string;
}): FileObjectStore {
  const root = path.resolve(options.root);
  const base = options.publicBaseUrl.replace(/\/+$/, '');
  const basePath = new URL(base).pathname.replace(/\/+$/, '');
  const pathFor = (bucket: string, key: string) => {
    checkLocation(bucket, key);
    return path.join(root, bucket, ...key.split('/'));
  };

  async function exists(bucket: string, key: string): Promise<boolean> {
    try {
      await access(pathFor(bucket, key), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  return {
    root,

    async put(bucket, key, buffer, contentType) {
      const target = pathFor(bucket, key);
      const sha256 = sha256Hex(buffer);
      const result = {
        bucket,
        key,
        url: `${base}/${bucket}/${key}`,
        bytes: buffer.length,
        sha256,
        contentType,
      };

      const incoming = path.join(root, INCOMING);
      await mkdir(incoming, { recursive: true });
      await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
      const temp = path.join(incoming, randomUUID());
      await writeFile(temp, buffer, { flag: 'wx', mode: 0o644 });
      // The umask may have narrowed the mode; nginx reads these as another user.
      await chmod(temp, 0o644);
      try {
        // link() refuses an existing target, so two writers can't both win.
        await link(temp, target);
        return { ...result, created: true };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = await readFile(target);
        if (sha256Hex(existing) !== sha256) throw new ObjectConflictError(bucket, key);
        return { ...result, created: false };
      } finally {
        await unlink(temp).catch(() => undefined);
      }
    },

    exists,

    read(bucket, key) {
      return readFile(pathFor(bucket, key));
    },

    urlFor(bucket, key) {
      checkLocation(bucket, key);
      return `${base}/${bucket}/${key}`;
    },

    locate(url) {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(url).pathname);
      } catch {
        return null;
      }
      if (!pathname.startsWith(`${basePath}/`)) return null;
      const [bucket, ...rest] = pathname.slice(basePath.length + 1).split('/');
      const key = rest.join('/');
      try {
        checkLocation(bucket ?? '', key);
      } catch {
        return null;
      }
      return { bucket: bucket!, key };
    },

    async freeBytes() {
      const stats = await statfs(root);
      return stats.bavail * stats.bsize;
    },

    async checkWritable() {
      await access(root, constants.W_OK);
    },
  };
}
