/**
 * S3-compatible ObjectStorage (AWS S3, Cloudflare R2, MinIO, …).
 * Keys are namespaced `{organizationId}/{key}` so tenants cannot address
 * each other's objects by guessing.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ObjectStorage, StoredObject } from '@platform/providers';

export interface S3ObjectStorageOptions {
  readonly bucket: string;
  readonly region: string;
  readonly endpoint?: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** R2 and some MinIO setups need path-style addressing. */
  readonly forcePathStyle?: boolean;
}

function objectKey(organizationId: string, key: string): string {
  const org = organizationId.trim();
  const object = key.trim();
  if (!org || org.includes('..') || org.includes('/') || org.includes('\\')) {
    throw new Error('storage: unsafe organization id');
  }
  if (!object || object.includes('..') || object.startsWith('/')) {
    throw new Error('storage: unsafe key');
  }
  return `${org}/${object}`;
}

export function createS3ObjectStorage(
  options: S3ObjectStorageOptions,
): ObjectStorage {
  const client = new S3Client({
    region: options.region,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  });

  return {
    name: 's3-compatible',

    async put({ organizationId, key, contentType, body }) {
      const Key = objectKey(organizationId, key);
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key,
          Body: body,
          ContentType: contentType,
        }),
      );
      return { key, byteSize: body.byteLength, contentType } satisfies StoredObject;
    },

    async get(organizationId, key) {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: options.bucket,
          Key: objectKey(organizationId, key),
        }),
      );
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) throw new Error('storage: empty object body');
      return bytes;
    },

    async delete(organizationId, key) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: options.bucket,
          Key: objectKey(organizationId, key),
        }),
      );
    },

    async exists(organizationId, key) {
      try {
        await client.send(
          new HeadObjectCommand({
            Bucket: options.bucket,
            Key: objectKey(organizationId, key),
          }),
        );
        return true;
      } catch (err) {
        const name =
          err && typeof err === 'object' && 'name' in err
            ? String((err as { name: unknown }).name)
            : '';
        const status =
          err && typeof err === 'object' && '$metadata' in err
            ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata
                ?.httpStatusCode
            : undefined;
        if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) {
          return false;
        }
        throw err;
      }
    },
  };
}

/** Exported for unit tests — same namespacing rules the adapter uses. */
export const __testOnly = { objectKey };
