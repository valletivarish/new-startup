/**
 * Cursor pagination — the API convention required by the Phase 1 boundary
 * ("pagination, filtering, sorting conventions").
 *
 * Keyset rather than offset: stable under concurrent inserts, and it does not
 * degrade as the audit trail grows. Every paginated ordering carries `id` as
 * a tiebreaker, so rows sharing a timestamp cannot be skipped or repeated.
 *
 * The cursor is an opaque base64url string. It encodes only values the caller
 * already received, and it is never trusted: a malformed or forged cursor is
 * a validation error, and the tenant filter is applied independently of it.
 */

import { z } from 'zod';
import { ApiError } from './errors.js';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().max(500).optional(),
});

export type PaginationInput = z.infer<typeof PaginationQuery>;

export interface Cursor {
  readonly createdAt: string;
  readonly id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );
    const result = z
      .object({ createdAt: z.string(), id: z.string().uuid() })
      .safeParse(parsed);
    if (!result.success) throw new Error('shape');
    return result.data;
  } catch {
    throw ApiError.validation([
      { field: 'cursor', message: 'Malformed cursor' },
    ]);
  }
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/**
 * Trims an over-fetched result set (limit + 1) into a page plus the cursor
 * for the next one. Fetching one extra row is how "is there more?" is
 * answered without a second count query.
 */
export function toPage<T extends { created_at: string; id: string }>(
  rows: readonly T[],
  limit: number,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.created_at, id: last.id })
        : null,
  };
}
