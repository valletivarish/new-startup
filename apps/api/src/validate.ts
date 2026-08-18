/**
 * Zod validation at the API boundary. Every request body and parameter is
 * parsed before use; failures become the standard validation error envelope.
 */

import type { z } from 'zod';
import { ApiError } from './errors.js';

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw ApiError.validation(
      result.error.issues.map((i) => ({
        field: i.path.join('.') || '(body)',
        message: i.message,
      })),
    );
  }
  return result.data;
}
