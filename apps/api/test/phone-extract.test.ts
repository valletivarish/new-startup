import { describe, expect, it } from 'vitest';
import { extractPhonesFromText } from '../src/hiring/phone-extract.js';

describe('extractPhonesFromText', () => {
  it('returns empty array for empty text', () => {
    expect(extractPhonesFromText('')).toEqual([]);
    expect(extractPhonesFromText('   ')).toEqual([]);
  });

  it('extracts +91 numbers with spaced groups', () => {
    expect(extractPhonesFromText('Reach me at +91 98765 43210')).toEqual([
      '+919876543210',
    ]);
  });

  it('extracts bare 10-digit Indian mobiles', () => {
    expect(extractPhonesFromText('Mobile: 9876543210')).toEqual(['9876543210']);
  });

  it('deduplicates the same number and prefers +91 form', () => {
    expect(
      extractPhonesFromText('Call +91 98765 43210 or 9876543210, again +919876543210'),
    ).toEqual(['+919876543210']);
  });

  it('ignores numbers shorter than 10 digits', () => {
    expect(extractPhonesFromText('Pin 12345, ext 987, mobile 9876543210')).toEqual([
      '9876543210',
    ]);
  });

  it('ignores +91 numbers whose mobile does not start with 6-9', () => {
    expect(extractPhonesFromText('Wrong +91 12345 67890')).toEqual([]);
    expect(extractPhonesFromText('Wrong +911234567890')).toEqual([]);
  });

  it('extracts 0-prefixed Indian mobiles as +91', () => {
    expect(extractPhonesFromText('Mobile: 09876543210')).toEqual(['+919876543210']);
    expect(extractPhonesFromText('Alt 0 98765 43210')).toEqual(['+919876543210']);
  });

  it('does not treat a prefix of a longer digit run as a phone', () => {
    expect(extractPhonesFromText('Ref +9198765432101234567890')).toEqual([]);
    expect(extractPhonesFromText('Alt +9112345678901234567890, ok 9876543210')).toEqual([
      '9876543210',
    ]);
  });

  it('extracts parenthesized and spaced India resume formats', () => {
    expect(extractPhonesFromText('Phone: (+91) 98765-43210')).toEqual([
      '+919876543210',
    ]);
    expect(extractPhonesFromText('Alt 91 98765 43210')).toEqual([
      '+919876543210',
    ]);
    expect(extractPhonesFromText('Mobile 98765 43210')).toEqual(['9876543210']);
  });
});
