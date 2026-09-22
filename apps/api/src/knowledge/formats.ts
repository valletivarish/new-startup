/**
 * Supported document formats for knowledge indexing.
 * Recruiters upload PDF / Word / PowerPoint; text/markdown remain for power users.
 */

import { ApiError } from '../errors.js';

export const SUPPORTED_CONTENT_TYPES = [
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export type SupportedContentType = (typeof SUPPORTED_CONTENT_TYPES)[number];

const EXTENSION_BY_TYPE: Record<SupportedContentType, readonly string[]> = {
  'text/plain': ['.txt', '.text'],
  'text/markdown': ['.md', '.markdown'],
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    '.docx',
  ],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [
    '.pptx',
  ],
};

const TEXT_TYPES = new Set<string>(['text/plain', 'text/markdown']);

/** 10 MiB — enough for typical JD / policy PDFs without inviting abuse. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export function isSupportedContentType(
  value: string,
): value is SupportedContentType {
  return (SUPPORTED_CONTENT_TYPES as readonly string[]).includes(value);
}

export function isTextContentType(contentType: string): boolean {
  return TEXT_TYPES.has(contentType);
}

/**
 * Guess MIME from filename when the browser sends a vague type.
 */
export function contentTypeFromFileName(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.pptx')) {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.txt') || lower.endsWith('.text')) return 'text/plain';
  return null;
}

/**
 * Validates a proposed upload (MIME, extension, size, basic shape).
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
        message: `Upload a PDF, Word (.docx), PowerPoint (.pptx), or text file (received "${contentType}").`,
      },
    ]);
  }

  const lower = name.toLowerCase();
  const allowed = EXTENSION_BY_TYPE[contentType];
  if (!allowed.some((ext) => lower.endsWith(ext))) {
    throw ApiError.validation([
      {
        field: 'name',
        message: `A ${contentType} document should end with ${allowed.join(' or ')}.`,
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

  if (isTextContentType(contentType)) {
    const probe = bytes.subarray(0, Math.min(bytes.byteLength, 8192));
    if (probe.includes(0)) {
      throw ApiError.validation([
        {
          field: 'content',
          message:
            'This looks like a binary file. Upload it as PDF, Word, or PowerPoint instead.',
        },
      ]);
    }
  } else {
    // Cheap magic-byte checks so a renamed .txt cannot pretend to be a PDF.
    if (contentType === 'application/pdf' && !looksLikePdf(bytes)) {
      throw ApiError.validation([
        {
          field: 'content',
          message: 'This file does not look like a real PDF.',
        },
      ]);
    }
    if (
      (contentType.includes('wordprocessingml') ||
        contentType.includes('presentationml')) &&
      !looksLikeZip(bytes)
    ) {
      throw ApiError.validation([
        {
          field: 'content',
          message: 'This file does not look like a Word or PowerPoint document.',
        },
      ]);
    }
  }

  return contentType;
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

/** @deprecated Prefer extractDocumentText — kept for call-site migration. */
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
  return decoded
    .replace(/\r\n/g, '\n')
    .replace(/\uFEFF/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
