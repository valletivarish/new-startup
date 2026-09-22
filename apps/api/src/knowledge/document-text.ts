/**
 * Extract readable plain text from uploaded document bytes.
 * Supports text/markdown plus office formats recruiters actually use.
 */

import { ApiError } from '../errors.js';

export async function extractDocumentText(
  contentType: string,
  bytes: Uint8Array,
): Promise<string> {
  switch (contentType) {
    case 'text/plain':
    case 'text/markdown':
      return decodeUtf8Text(bytes);
    case 'application/pdf':
      return extractPdf(bytes);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractDocx(bytes);
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return extractPptx(bytes);
    default:
      throw ApiError.validation([
        {
          field: 'contentType',
          message: `This file type cannot be read (${contentType}).`,
        },
      ]);
  }
}

function decodeUtf8Text(bytes: Uint8Array): string {
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
  return normalizeText(decoded);
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  let parser: { getText: () => Promise<{ text: string }>; destroy: () => Promise<void> } | null =
    null;
  try {
    const { PDFParse } = await import('pdf-parse');
    parser = new PDFParse({ data: Buffer.from(bytes) });
    const result = await parser.getText();
    const text = normalizeText(result.text ?? '');
    if (!text) {
      throw ApiError.validation([
        {
          field: 'content',
          message:
            'This PDF has no readable text. Use a text-based PDF, or paste the text instead of uploading a scanned image.',
        },
      ]);
    }
    return text;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw ApiError.validation([
      {
        field: 'content',
        message: 'This PDF could not be read. Try exporting it again as a PDF.',
      },
    ]);
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    const text = normalizeText(result.value ?? '');
    if (!text) {
      throw ApiError.validation([
        {
          field: 'content',
          message: 'This Word file has no readable text.',
        },
      ]);
    }
    return text;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw ApiError.validation([
      {
        field: 'content',
        message: 'This Word file could not be read. Save it as .docx and try again.',
      },
    ]);
  }
}

async function extractPptx(bytes: Uint8Array): Promise<string> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(Buffer.from(bytes));
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const parts: string[] = [];
    for (const name of slideFiles) {
      const xml = await zip.files[name]!.async('string');
      const text = xml
        .replace(/<a:t[^>]*>/g, '')
        .replace(/<\/a:t>/g, ' ')
        .replace(/<[^>]+>/g, ' ');
      const cleaned = normalizeText(text);
      if (cleaned) parts.push(cleaned);
    }

    const joined = normalizeText(parts.join('\n\n'));
    if (!joined) {
      throw ApiError.validation([
        {
          field: 'content',
          message: 'This PowerPoint file has no readable text.',
        },
      ]);
    }
    return joined;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw ApiError.validation([
      {
        field: 'content',
        message:
          'This PowerPoint file could not be read. Save it as .pptx and try again.',
      },
    ]);
  }
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\uFEFF/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
