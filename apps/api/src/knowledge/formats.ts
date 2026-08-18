/**
 * Supported document formats.
 *
 * Deliberately small. The phase brief is explicit: a format that cannot be
 * processed reliably must be REJECTED clearly, not accepted and quietly
 * indexed as garbage. Adding PDF or DOCX means adding a parser dependency and
 * a whole class of malformed-file failure modes, so that is a decision to make
 * with a reason rather than by default.
 */

import { ApiError } from '../errors.js';

export const SUPPORTED_CONTENT_TYPES = ['text/plain', 'text/markdown'] as const;

export type SupportedContentType = (typeof SUPPORTED_CONTENT_TYPES)[number];

const EXTENSION_BY_TYPE: Record<SupportedContentType, readonly string[]> = {
  'text/plain': ['.txt', '.text'],
  'text/markdown': ['.md', '.markdown'],
};

/** 2 MiB. Generous for text, small enough that a bad upload cannot hurt. */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

export function isSupportedContentType(
  value: string,
): value is SupportedContentType {
  return (SUPPORTED_CONTENT_TYPES as readonly string[]).includes(value);
}

/**
 * Validates a proposed upload.
 *
 * Checks the declared MIME type, the filename extension AND the bytes
 * themselves — a caller can claim any content type, so the claim alone is not
 * evidence.
 */
export function validateUpload(params: {
  readonly name: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}): SupportedContentType {
  const { name, contentType, bytes } = params;

  if (!isSupportedContentType(contentType)) {
    throw ApiError.validation([
      {
        field: 'contentType',
        message: `Only plain text and Markdown can be indexed today (received "${contentType}"). Convert the file to .txt or .md and upload it again.`,
      },
    ]);
  }

  const lower = name.toLowerCase();
  const allowed = EXTENSION_BY_TYPE[contentType];
  if (!allowed.some((ext) => lower.endsWith(ext))) {
    throw ApiError.validation([
      {
        field: 'name',
        message: `A ${contentType} document should have one of these extensions: ${allowed.join(', ')}`,
      },
    ]);
  }

  if (bytes.byteLength === 0) {
    throw ApiError.validation([
      { field: 'content', message: 'The document is empty.' },
    ]);
  }
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw ApiError.validation([
      {
        field: 'content',
        message: `Documents are limited to ${Math.floor(
          MAX_DOCUMENT_BYTES / 1024 / 1024,
        )} MB.`,
      },
    ]);
  }

  // Reject binary masquerading as text: a NUL byte in the first block is the
  // cheapest reliable signal, and it is what stops a renamed PDF being
  // "successfully" indexed as mojibake.
  const probe = bytes.subarray(0, Math.min(bytes.byteLength, 8192));
  if (probe.includes(0)) {
    throw ApiError.validation([
      {
        field: 'content',
        message:
          'This looks like a binary file rather than text. Only plain text and Markdown can be indexed today.',
      },
    ]);
  }

  return contentType;
}

/**
 * Decodes bytes to text and normalises whitespace.
 *
 * `fatal: true` — invalid UTF-8 raises rather than producing replacement
 * characters, so a mis-encoded file fails loudly instead of being indexed as
 * nonsense.
 */
export function extractText(bytes: Uint8Array): string {
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw ApiError.validation([
      {
        field: 'content',
        message: 'The document is not valid UTF-8 text and could not be read.',
      },
    ]);
  }

  return (
    decoded
      // Normalise line endings and strip a byte-order mark so chunk
      // boundaries are stable across platforms.
      .replace(/\r\n/g, '\n')
      .replace(/\uFEFF/g, '')
      // Collapse runs of blank lines: chunking splits on them, so this keeps
      // the same document producing the same chunks on every re-index.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
