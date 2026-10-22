/**
 * Careers-page form: the pure parts (validation, wording, colours), shared by the embed script
 * and the job page's preview, and unit-tested. No DOM here.
 */

export interface FormValues {
  fullName: string;
  phone: string;
  email: string;
  consent: boolean;
}

export type FormErrors = Partial<Record<keyof FormValues, string>>;

/** An Indian mobile as 10 digits ("+91 98765-43210" → "9876543210"), or null. Same rule as the API. */
export function indianMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, '').replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validate(v: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (!v.fullName.trim()) errors.fullName = 'Enter your name.';
  else if (v.fullName.trim().length > 200) errors.fullName = 'Use 200 characters or fewer.';
  if (!v.phone.trim()) errors.phone = 'Enter your mobile number.';
  else if (!indianMobile(v.phone)) errors.phone = 'Enter a 10-digit Indian mobile number.';
  if (v.email.trim() && !EMAIL_RE.test(v.email.trim())) errors.email = 'Enter a valid email, or leave it empty.';
  if (!v.consent) errors.consent = 'Tick the box to agree to the screening call.';
  return errors;
}

export const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? '';

/** The thank-you line. `callAfter` is set when the call waits for calling hours (9 am to 8 pm IST). */
export function confirmation(fullName: string, callAfter: string | null): string {
  const name = firstName(fullName);
  const thanks = name ? `Thanks, ${name}.` : 'Thanks.';
  return callAfter
    ? `${thanks} You’ll get a call from our hiring team’s screening assistant after 9 am India time.`
    : `${thanks} You’ll get a call from our hiring team’s screening assistant shortly.`;
}

export const consentLabel = (company: string) =>
  `I agree to get an automated screening phone call from ${company} about this job. The call is recorded so the hiring team can review my answers.`;

/** A server error, in the words the form shows. `field` when it belongs next to an input. */
export function serverMessage(
  status: number,
  body: { code?: string; errors?: { field: string; message: string }[] } | null,
): { field?: keyof FormValues; message: string }[] {
  if (status === 422 && body?.code === 'consent_required') {
    return [{ field: 'consent', message: 'Tick the box to agree to the screening call.' }];
  }
  if (status === 422 && body?.errors?.length) {
    const known = new Set<string>(['fullName', 'phone', 'email', 'consent']);
    return body.errors.map((e) =>
      known.has(e.field) ? { field: e.field as keyof FormValues, message: e.message } : { message: e.message },
    );
  }
  if (status === 429) return [{ message: 'Too many tries just now. Please wait a minute and try again.' }];
  if (status === 403 || status === 404) return [{ message: 'This form isn’t taking applications right now.' }];
  return [{ message: 'We couldn’t send your details. Please try again in a moment.' }];
}

// --- Colours (WCAG 2.2 relative luminance) ------------------------------------------------

const DEFAULT_ACCENT = '#0F1A2E';

function rgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(rgb(a) ?? [0, 0, 0]);
  const lb = luminance(rgb(b) ?? [0, 0, 0]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The button colour from `data-accent`, the text on it (white or near-black, whichever reads
 * better) and a focus ring that keeps 3:1 against the white card even for a pale accent.
 */
export function accentColours(raw: string | undefined): { accent: string; onAccent: string; ring: string } {
  const accent = raw && rgb(raw) ? raw.trim() : DEFAULT_ACCENT;
  // Pure black or white: one of them always clears 4.5:1, whatever the accent.
  const onAccent = contrast(accent, '#FFFFFF') >= contrast(accent, '#000000') ? '#FFFFFF' : '#000000';
  const ring = contrast(accent, '#FFFFFF') >= 3 ? accent : '#111827';
  return { accent, onAccent, ring };
}
