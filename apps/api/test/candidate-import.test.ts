import { describe, expect, it } from 'vitest';

import {
  normalizePhoneParts,
  previewCandidateImport,
  validateConfirmRows,
} from '../src/hiring/candidate-import.js';

describe('normalizePhoneParts', () => {
  it('splits E.164 into country + national', () => {
    expect(normalizePhoneParts('+919876543210', null)).toEqual({
      countryCode: '+91',
      phone: '9876543210',
    });
  });

  it('uses country column with national phone', () => {
    expect(normalizePhoneParts('9876543210', 'IN')).toEqual({
      countryCode: '+91',
      phone: '9876543210',
    });
  });

  it('defaults country to +91 when only national mobile given', () => {
    expect(normalizePhoneParts('9876543210', null)).toEqual({
      countryCode: '+91',
      phone: '9876543210',
    });
  });
});

describe('previewCandidateImport', () => {
  it('maps Name / Mobile / Country aliases', () => {
    const csv = [
      'Name,Mobile,Country,Email',
      'Asha Patel,9876543210,+91,asha@example.com',
      'Missing Phone,,+91,',
    ].join('\n');

    const result = previewCandidateImport(csv);
    expect(result.summary.total).toBe(2);
    expect(result.summary.valid).toBe(1);
    expect(result.rows[0]).toMatchObject({
      fullName: 'Asha Patel',
      countryCode: '+91',
      phone: '9876543210',
      email: 'asha@example.com',
      valid: true,
    });
    expect(result.rows[1]?.issues).toContain('missing_phone');
  });

  it('flags duplicate phones within batch and on job', () => {
    const csv = [
      'Full Name,Country Code,Phone',
      'One,+91,9876543210',
      'Two,+91,9876543210',
      'Three,+91,9123456789',
    ].join('\n');

    const result = previewCandidateImport(csv, new Set(['9123456789']));
    expect(result.rows[1]?.issues).toContain('duplicate_in_batch');
    expect(result.rows[2]?.issues).toContain('duplicate_on_job');
    expect(result.summary.valid).toBe(1);
  });

  it('merges first + last name columns', () => {
    const csv = 'First Name,Last Name,Phone,Dial code\nRiya,Shah,9988776655,91';
    const result = previewCandidateImport(csv);
    expect(result.rows[0]).toMatchObject({
      fullName: 'Riya Shah',
      countryCode: '+91',
      phone: '9988776655',
      valid: true,
    });
  });
});

describe('validateConfirmRows', () => {
  it('accepts only complete unique rows', () => {
    const { accepted, rejected } = validateConfirmRows(
      [
        { fullName: 'A', countryCode: '+91', phone: '9876543210' },
        { fullName: '', countryCode: '+91', phone: '9123456789' },
        { fullName: 'B', countryCode: '+91', phone: '9876543210' },
      ],
      new Set(),
    );
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(2);
  });
});
