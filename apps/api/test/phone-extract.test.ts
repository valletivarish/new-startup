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
});
