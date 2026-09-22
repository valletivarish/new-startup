/**
 * Pick ObjectStorage from env: local filesystem (dev) or S3-compatible (prod).
 */

import type { ObjectStorage } from '@platform/providers';

import type { Env } from '../config.js';
import { createLocalObjectStorage } from './local-object-storage.js';
import { createS3ObjectStorage } from './s3-object-storage.js';

export function createObjectStorage(env: Env): ObjectStorage {
  if (env.STORAGE_BACKEND === 's3') {
    return createS3ObjectStorage({
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }

  return createLocalObjectStorage(env.STORAGE_ROOT);
}
