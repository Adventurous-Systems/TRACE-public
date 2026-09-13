import * as Minio from 'minio';
import { env } from '../env.js';

export const minioClient = new Minio.Client({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

/**
 * Ensure a bucket exists, creating it if needed.
 */
export async function ensureBucket(
  bucket: string,
  options: { publicRead?: boolean } = {},
): Promise<void> {
  const exists = await minioClient.bucketExists(bucket);
  if (!exists) await minioClient.makeBucket(bucket);

  // Anonymous reads are opt-in and intended only for an isolated public demo.
  // Reconcile the policy because a pre-created demo bucket may still be private.
  if (options.publicRead) {
    const policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucket}/*`],
        },
      ],
    });
    await minioClient.setBucketPolicy(bucket, policy);
  }
}

/**
 * Upload a buffer to MinIO and return the public URL.
 */
export async function uploadBuffer(
  bucket: string,
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  await ensureBucket(bucket, {
    publicRead: bucket === env.MINIO_BUCKET_PASSPORTS && env.MINIO_PUBLIC_READ,
  });
  await minioClient.putObject(bucket, key, buffer, buffer.length, {
    'Content-Type': contentType,
  });
  const baseUrl = env.MINIO_PUBLIC_URL ?? `http://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`;
  return `${baseUrl}/${bucket}/${key}`;
}
