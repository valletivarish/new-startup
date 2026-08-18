/**
 * Filesystem-backed ObjectStorage.
 *
 * This is a real implementation of the approved abstraction, not a stub. No
 * object-storage provider is selected yet, and Cloudflare R2 becomes another
 * implementation of the same interface with no change above it — which is the
 * point of having the interface.
 *
 * Two security properties it must hold:
 *
 *   * keys are namespaced by organization, so one tenant's object cannot be
 *     addressed from another tenant's context even by guessing;
 *   * keys are sanitised, so a `../` in a caller-supplied name cannot escape
 *     the storage root.
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import type { ObjectStorage, StoredObject } from '@platform/providers';

/** Rejects traversal and absolute paths before they ever reach the disk. */
function safeSegment(value: string, label: string): string {
  const normalised = normalize(value).replace(/^(\.\.(\/|\\|$))+/, '');
  if (
    normalised.length === 0 ||
    normalised.startsWith(sep) ||
    normalised.includes('..') ||
    /[\0]/.test(normalised)
  ) {
    throw new Error(`storage: unsafe ${label}`);
  }
  return normalised;
}

export function createLocalObjectStorage(root: string): ObjectStorage {
  const storageRoot = resolve(root);

  function pathFor(organizationId: string, key: string): string {
    const org = safeSegment(organizationId, 'organization id');
    const objectKey = safeSegment(key, 'key');
    const full = resolve(join(storageRoot, org, objectKey));
    // Final guard: the resolved path must still be inside the root.
    if (!full.startsWith(storageRoot + sep)) {
      throw new Error('storage: key escapes the storage root');
    }
    return full;
  }

  return {
    name: 'local-filesystem',

    async put({ organizationId, key, contentType, body }) {
      const path = pathFor(organizationId, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      return { key, byteSize: body.byteLength, contentType } satisfies StoredObject;
    },

    async get(organizationId, key) {
      const path = pathFor(organizationId, key);
      return new Uint8Array(await readFile(path));
    },

    async delete(organizationId, key) {
      await rm(pathFor(organizationId, key), { force: true });
    },

    async exists(organizationId, key) {
      try {
        await stat(pathFor(organizationId, key));
        return true;
      } catch {
        return false;
      }
    },
  };
}
