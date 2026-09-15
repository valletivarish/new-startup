/**
 * Structured output validation.
 *
 * Model output is UNTRUSTED INPUT. It is not "our" data because it came back
 * from our own request — it is generated text, shaped by whatever was in the
 * context, including documents and user messages we do not control.
 *
 * So it is validated exactly like a request body: parsed defensively, bounded
 * in size, checked against a schema, and REJECTED on mismatch. A model that
 * returns the wrong shape produces a typed validation failure the runtime can
 * act on — never a silently coerced object, never a partially-filled record,
 * and never a business action taken on a guess.
 */

import type { z } from 'zod';

/** A model response larger than this is refused before parsing. */
export const MAX_STRUCTURED_CHARS = 100_000;

export type StructuredResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

function issuesOf(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * Parse a JSON string emitted by a model.
 *
 * Models routinely wrap JSON in prose or a fenced code block. Recovering from
 * that is fine — GUESSING at the content is not, so the extraction is limited
 * to stripping a fence, never to repairing malformed JSON.
 */
export function parseModelJson(raw: string): StructuredResult<unknown> {
  if (raw.length > MAX_STRUCTURED_CHARS) {
    return { ok: false, errors: ['The response was too large to process.'] };
  }

  let text = raw.trim();
  if (text.startsWith('```')) {
    const firstNewline = text.indexOf('\n');
    const closing = text.lastIndexOf('```');
    if (firstNewline !== -1 && closing > firstNewline) {
      text = text.slice(firstNewline + 1, closing).trim();
    }
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, errors: ['The response was not valid JSON.'] };
  }
}

/**
 * Validate an already-parsed value against a schema.
 *
 * `safeParse`, never `parse`: a thrown ZodError deep inside the runtime loop
 * would be caught by a generic handler and reported as a platform fault, when
 * the truth is that the MODEL produced something invalid — a different fact
 * with a different response.
 */
export function validateStructured<T>(
  schema: z.ZodType<T>,
  value: unknown,
): StructuredResult<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, errors: issuesOf(parsed.error) };
}

/** Parse JSON text and validate it in one step. */
export function parseAndValidate<T>(
  schema: z.ZodType<T>,
  raw: string,
): StructuredResult<T> {
  const parsed = parseModelJson(raw);
  if (!parsed.ok) return parsed;
  return validateStructured(schema, parsed.value);
}
