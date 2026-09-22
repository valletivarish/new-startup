/**
 * Flexible CSV (or TSV) candidate intake for a Job.
 *
 * Maps common header aliases → full_name / country_code / phone / email.
 * Validation flags incomplete or duplicate phones; confirm creates only valid rows.
 */

export type ImportIssue =
  | 'missing_full_name'
  | 'missing_country_code'
  | 'missing_phone'
  | 'invalid_phone'
  | 'invalid_email'
  | 'duplicate_in_batch'
  | 'duplicate_on_job';

export interface NormalizedImportRow {
  readonly rowIndex: number;
  readonly fullName: string | null;
  readonly countryCode: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly raw: Record<string, string>;
  readonly issues: readonly ImportIssue[];
  readonly valid: boolean;
}

export interface ImportPreviewResult {
  readonly rows: readonly NormalizedImportRow[];
  readonly summary: {
    readonly total: number;
    readonly valid: number;
    readonly invalid: number;
  };
}

const HEADER_ALIASES: Record<string, 'full_name' | 'country_code' | 'phone' | 'email'> = {
  full_name: 'full_name',
  fullname: 'full_name',
  name: 'full_name',
  candidate_name: 'full_name',
  candidate: 'full_name',
  'full name': 'full_name',
  'candidate name': 'full_name',
  first_name: 'full_name', // will merge with last_name if present
  last_name: 'full_name',
  country_code: 'country_code',
  countrycode: 'country_code',
  country: 'country_code',
  dial_code: 'country_code',
  dialcode: 'country_code',
  'country code': 'country_code',
  'dial code': 'country_code',
  phone: 'phone',
  mobile: 'phone',
  cellphone: 'phone',
  cell: 'phone',
  telephone: 'phone',
  tel: 'phone',
  phone_number: 'phone',
  mobilenumber: 'phone',
  'phone number': 'phone',
  'mobile number': 'phone',
  email: 'email',
  e_mail: 'email',
  'e-mail': 'email',
  email_address: 'email',
  'email address': 'email',
};

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\uFEFF]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function detectDelimiter(headerLine: string): string {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  const semis = (headerLine.match(/;/g) ?? []).length;
  if (tabs > commas && tabs >= semis) return '\t';
  if (semis > commas) return ';';
  return ',';
}

function normalizeCountryCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const iso = trimmed.toUpperCase();
    const map: Record<string, string> = {
      IN: '+91',
      AE: '+971',
      SG: '+65',
      GB: '+44',
      UK: '+44',
      US: '+1',
      CA: '+1',
      AU: '+61',
      DE: '+49',
      PH: '+63',
      BD: '+880',
      NP: '+977',
      LK: '+94',
    };
    return map[iso] ?? null;
  }
  const digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('+') && /^\+[1-9]\d{0,3}$/.test(digits)) return digits;
  const only = digits.replace(/\D/g, '');
  if (only.length >= 1 && only.length <= 4) return `+${only}`;
  return null;
}

/** Prefer national digits when country is separate; accept E.164 phone columns. */
export function normalizePhoneParts(
  phoneRaw: string | null | undefined,
  countryRaw: string | null | undefined,
): { countryCode: string | null; phone: string | null } {
  const countryFromCol = normalizeCountryCode(countryRaw);
  const phoneTrim = (phoneRaw ?? '').trim();
  if (!phoneTrim) {
    return { countryCode: countryFromCol, phone: null };
  }

  const digits = phoneTrim.replace(/[^\d+]/g, '');
  if (digits.startsWith('+') && /^\+[1-9]\d{7,14}$/.test(digits)) {
    // Split E.164 into country + national when possible (India-first).
    const rest = digits.slice(1);
    const dials = ['971', '880', '977', '91', '65', '44', '61', '49', '63', '94', '1'];
    for (const dial of dials) {
      if (rest.startsWith(dial) && rest.length > dial.length) {
        return {
          countryCode: countryFromCol ?? `+${dial}`,
          phone: rest.slice(dial.length),
        };
      }
    }
    return {
      countryCode: countryFromCol ?? `+${rest.slice(0, 2)}`,
      phone: rest.slice(2),
    };
  }

  let national = digits.replace(/\D/g, '');
  if (national.startsWith('0') && national.length > 1) national = national.slice(1);

  const country = countryFromCol ?? '+91';
  const dialDigits = country.replace(/\D/g, '');
  if (dialDigits && national.startsWith(dialDigits) && national.length > dialDigits.length + 5) {
    national = national.slice(dialDigits.length);
  }

  if (!national) return { countryCode: country, phone: null };
  return { countryCode: country, phone: national };
}

function isLikelyValidPhone(countryCode: string, phone: string): boolean {
  const national = phone.replace(/\D/g, '');
  if (national.length < 6 || national.length > 15) return false;
  if (countryCode === '+91') {
    return national.length === 10 && /^[6-9]/.test(national);
  }
  return true;
}

function isLikelyEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Parse CSV/TSV text into normalized preview rows.
 * `existingPhones` are phones already on the job (national or raw stored form).
 */
export function previewCandidateImport(
  csvText: string,
  existingPhones: ReadonlySet<string> = new Set(),
): ImportPreviewResult {
  const text = csvText.replace(/^\uFEFF/, '').trim();
  if (!text) {
    return { rows: [], summary: { total: 0, valid: 0, invalid: 0 } };
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { rows: [], summary: { total: 0, valid: 0, invalid: 0 } };
  }

  const delimiter = detectDelimiter(lines[0]!);
  const headerCells = splitCsvLine(lines[0]!, delimiter);
  const columnMap: Array<'full_name' | 'country_code' | 'phone' | 'email' | 'first_name' | 'last_name' | null> =
    headerCells.map((h) => {
      const key = normalizeHeader(h);
      const compact = key.replace(/\s+/g, '_');
      const compactNospace = key.replace(/\s+/g, '');
      if (key === 'first name' || compact === 'first_name') return 'first_name';
      if (key === 'last name' || compact === 'last_name') return 'last_name';
      return (
        HEADER_ALIASES[key] ??
        HEADER_ALIASES[compact] ??
        HEADER_ALIASES[compactNospace] ??
        null
      );
    });

  // If no headers matched, treat first row as data with positional guess:
  // Name, Phone, Country? — but prefer requiring headers. Fall back: col0 name, col1 phone.
  const hasMapped = columnMap.some((c) => c === 'full_name' || c === 'phone' || c === 'first_name');
  const dataStart = hasMapped ? 1 : 0;
  if (!hasMapped && headerCells.length >= 2) {
    // Reinterpret first line as data; map positionally.
    columnMap.length = 0;
    columnMap.push('full_name', 'phone');
    if (headerCells.length >= 3) columnMap.push('country_code');
    if (headerCells.length >= 4) columnMap.push('email');
  }

  const draftRows: Array<{
    rowIndex: number;
    fullName: string | null;
    countryCode: string | null;
    phone: string | null;
    email: string | null;
    raw: Record<string, string>;
    issues: ImportIssue[];
  }> = [];

  for (let li = dataStart; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]!, delimiter);
    const raw: Record<string, string> = {};
    headerCells.forEach((h, i) => {
      raw[h || `col${i}`] = cells[i] ?? '';
    });

    let firstName = '';
    let lastName = '';
    let fullName: string | null = null;
    let countryRaw: string | null = null;
    let phoneRaw: string | null = null;
    let emailRaw: string | null = null;

    for (let i = 0; i < columnMap.length; i++) {
      const kind = columnMap[i];
      const val = (cells[i] ?? '').trim();
      if (!kind || !val) continue;
      if (kind === 'first_name') firstName = val;
      else if (kind === 'last_name') lastName = val;
      else if (kind === 'full_name') fullName = val;
      else if (kind === 'country_code') countryRaw = val;
      else if (kind === 'phone') phoneRaw = val;
      else if (kind === 'email') emailRaw = val;
    }

    if (!fullName && (firstName || lastName)) {
      fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
    }

    const { countryCode, phone } = normalizePhoneParts(phoneRaw, countryRaw);
    const email = emailRaw ? emailRaw.toLowerCase() : null;

    const issues: ImportIssue[] = [];
    if (!fullName) issues.push('missing_full_name');
    if (!countryCode) issues.push('missing_country_code');
    if (!phone) issues.push('missing_phone');
    else if (countryCode && !isLikelyValidPhone(countryCode, phone)) {
      issues.push('invalid_phone');
    }
    if (email && !isLikelyEmail(email)) issues.push('invalid_email');

    draftRows.push({
      rowIndex: li + 1, // 1-based line number in source
      fullName,
      countryCode,
      phone,
      email,
      raw,
      issues,
    });
  }

  // Batch duplicate phones (normalized national under country).
  const phoneKey = (country: string | null, phone: string | null) =>
    country && phone ? `${country}|${phone.replace(/\D/g, '')}` : null;

  const seen = new Map<string, number>();
  for (const row of draftRows) {
    const key = phoneKey(row.countryCode, row.phone);
    if (!key) continue;
    if (seen.has(key)) {
      row.issues.push('duplicate_in_batch');
    } else {
      seen.set(key, row.rowIndex);
    }
  }

  // Existing job phones — match national digits or full E.164 digits.
  const existingNormalized = new Set<string>();
  for (const p of existingPhones) {
    const digits = p.replace(/\D/g, '');
    if (digits) existingNormalized.add(digits);
  }

  for (const row of draftRows) {
    if (!row.phone) continue;
    const national = row.phone.replace(/\D/g, '');
    const withCountry = `${(row.countryCode ?? '').replace(/\D/g, '')}${national}`;
    if (
      existingNormalized.has(national) ||
      existingNormalized.has(withCountry)
    ) {
      if (!row.issues.includes('duplicate_on_job')) {
        row.issues.push('duplicate_on_job');
      }
    }
  }

  const rows: NormalizedImportRow[] = draftRows.map((r) => ({
    rowIndex: r.rowIndex,
    fullName: r.fullName,
    countryCode: r.countryCode,
    phone: r.phone,
    email: r.email,
    raw: r.raw,
    issues: r.issues,
    valid: r.issues.length === 0,
  }));

  const valid = rows.filter((r) => r.valid).length;
  return {
    rows,
    summary: {
      total: rows.length,
      valid,
      invalid: rows.length - valid,
    },
  };
}

/** Rows accepted by confirm — already validated client/server-side. */
export interface ConfirmImportRow {
  readonly fullName: string;
  readonly countryCode: string;
  readonly phone: string;
  readonly email?: string;
}

export function validateConfirmRows(
  rows: readonly ConfirmImportRow[],
  existingPhones: ReadonlySet<string> = new Set(),
): {
  readonly accepted: ConfirmImportRow[];
  readonly rejected: Array<{ row: ConfirmImportRow; issues: ImportIssue[] }>;
} {
  const existingNormalized = new Set<string>();
  for (const p of existingPhones) {
    const digits = p.replace(/\D/g, '');
    if (digits) existingNormalized.add(digits);
  }

  const accepted: ConfirmImportRow[] = [];
  const rejected: Array<{ row: ConfirmImportRow; issues: ImportIssue[] }> = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const issues: ImportIssue[] = [];
    const fullName = row.fullName?.trim() ?? '';
    const { countryCode, phone } = normalizePhoneParts(row.phone, row.countryCode);
    const email = row.email?.trim() ? row.email.trim().toLowerCase() : undefined;

    if (!fullName) issues.push('missing_full_name');
    if (!countryCode) issues.push('missing_country_code');
    if (!phone) issues.push('missing_phone');
    else if (countryCode && !isLikelyValidPhone(countryCode, phone)) {
      issues.push('invalid_phone');
    }
    if (email && !isLikelyEmail(email)) issues.push('invalid_email');

    const key = countryCode && phone ? `${countryCode}|${phone.replace(/\D/g, '')}` : null;
    if (key) {
      if (seen.has(key)) issues.push('duplicate_in_batch');
      else seen.add(key);
      const national = phone!.replace(/\D/g, '');
      const withCountry = `${countryCode!.replace(/\D/g, '')}${national}`;
      if (existingNormalized.has(national) || existingNormalized.has(withCountry)) {
        issues.push('duplicate_on_job');
      }
    }

    if (issues.length > 0) {
      rejected.push({ row, issues });
    } else {
      accepted.push({
        fullName,
        countryCode: countryCode!,
        phone: phone!,
        ...(email ? { email } : {}),
      });
    }
  }

  return { accepted, rejected };
}
