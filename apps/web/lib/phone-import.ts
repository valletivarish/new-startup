/**
 * Phone numbers from an uploaded list: CSV, plain text, or an Excel .xlsx file. Every number
 * comes back in E.164 (+919876543210), duplicates dropped; lines with no number are counted so
 * the form can say how many it skipped.
 */

import { composeE164, splitE164 } from './phone-field';

// A run of digits with the usual separators, optionally led by +.
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;

/** "9.87654321E9" (how a spreadsheet may save a long number) → "9876543210". */
function expandExponent(line: string): string {
  return line.replace(/\b\d(?:\.\d+)?[eE]\+?\d{1,2}\b/g, (m) => {
    const n = Number(m);
    return Number.isFinite(n) ? n.toFixed(0) : m;
  });
}

function toE164(raw: string): string | null {
  let value = raw.trim();
  // Without a +, a leading trunk 0 (091…, 0987…) goes first.
  if (!value.startsWith('+')) value = value.replace(/^\D*0+/, '');
  const { dial, national } = splitE164(value);
  const e164 = composeE164(dial, national);
  const digits = e164.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? e164 : null;
}

export function numbersFromText(text: string): { numbers: string[]; skipped: number } {
  const numbers: string[] = [];
  let skipped = 0;
  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = expandExponent(rawLine).trim();
    if (!line) return;
    const found = (line.match(PHONE) ?? []).map(toE164).filter((n): n is string => n !== null);
    // A first row with no digits is a header ("Name,Phone"), not a row that lost its number.
    if (found.length === 0 && !(index === 0 && !/\d/.test(line))) skipped += 1;
    for (const n of found) if (!numbers.includes(n)) numbers.push(n);
  });
  return { numbers, skipped };
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** The files inside a zip, by name. Only what an .xlsx needs: stored or deflated entries. */
async function unzip(blob: Blob, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  let end = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip');
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    if (method === 0) out.set(name, dec.decode(data));
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out.set(name, await new Response(stream).text());
    }
  }
  return out;
}

/** An .xlsx file's cells as text: one line per row, cells joined by commas. */
export async function xlsxText(file: Blob): Promise<string> {
  const parts = await unzip(file, (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = [...(parts.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decodeXml([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
  const lines: string[] = [];
  for (const [name, xml] of parts) {
    if (!name.startsWith('xl/worksheets/')) continue;
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [...row[1]!.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map(([, attrs, body]) => {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body!)?.[1];
        if (/\bt="s"/.test(attrs!) && v !== undefined) return shared[Number(v)] ?? '';
        const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body!)?.[1];
        return decodeXml(inline ?? v ?? '');
      });
      lines.push(cells.join(','));
    }
  }
  return lines.join('\n');
}

/** Numbers from any supported file: .xlsx is unzipped, anything else is read as text. */
export async function numbersFromFile(file: File): Promise<{ numbers: string[]; skipped: number }> {
  const isXlsx = /\.xlsx$/i.test(file.name) || file.type.includes('spreadsheetml');
  return numbersFromText(isXlsx ? await xlsxText(file) : await file.text());
}
