import { describe, expect, it } from 'vitest';
import { numbersFromText, xlsxText } from './phone-import';

describe('numbersFromText', () => {
  it('finds numbers in a CSV or a pasted list, in Indian and international formats', () => {
    const csv = 'Name,Phone\nAsha,+91 98765 43210\nRavi,9876543211\nMeena,091-98765-43212\nOffice,+971 50 123 4567';
    expect(numbersFromText(csv).numbers).toEqual([
      '+919876543210',
      '+919876543211',
      '+919876543212',
      '+971501234567',
    ]);
    expect(numbersFromText(csv).skipped).toBe(0);
  });

  it('drops duplicates and counts lines that are not numbers', () => {
    const r = numbersFromText('98765 43210\n+919876543210\nnot a number\n12\n');
    expect(r.numbers).toEqual(['+919876543210']);
    expect(r.skipped).toBe(2);
  });

  it('reads numbers that a spreadsheet stored as plain numbers', () => {
    expect(numbersFromText('919876543210\n9.87654321E9').numbers).toEqual(['+919876543210']);
  });
});

describe('xlsxText', () => {
  it('reads text and numbers out of an .xlsx file', async () => {
    const file = await tinyXlsx({
      'xl/sharedStrings.xml': '<sst><si><t>Phone</t></si><si><t>+91 98765 43210</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row><c t="s"><v>0</v></c></row><row><c t="s"><v>1</v></c></row><row><c><v>9876543211</v></c></row></sheetData></worksheet>',
    });
    const text = await xlsxText(file);
    expect(numbersFromText(text).numbers).toEqual(['+919876543210', '+919876543211']);
  });
});

/** A minimal zip (deflate-raw entries) with the given files, like an .xlsx. */
async function tinyXlsx(files: Record<string, string>): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const raw = enc.encode(body);
    const data = new Uint8Array(
      await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
    );
    const nameBytes = enc.encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    parts.push(local, data);
    central.push(cen);
    offset += local.length + data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end] as BlobPart[]);
}
