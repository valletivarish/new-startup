import { splitE164 } from './phone-field';

/**
 * A timestamp as epoch ms, NaN when missing or unreadable. Takes ISO and Postgres text
 * ("2026-10-02 03:12:45.123456+00"), which Safari refuses for its space, its microseconds
 * and its bare hour offset.
 */
export function timeOf(value: string | null | undefined): number {
  if (!value) return NaN;
  return Date.parse(
    value
      .trim()
      .replace(' ', 'T')
      .replace(/(\.\d{3})\d+/, '$1')
      .replace(/(T[\d:.]+[+-]\d\d)$/, '$1:00'),
  );
}

/** en-IN date and 24-hour time: "1 Oct, 14:05". Adds the year outside the current one. '' when missing. */
export function formatWhen(iso: string | null | undefined, now: Date = new Date()): string {
  const t = timeOf(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const date = d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${date}, ${time}`;
}

/** Call length as m:ss ("5:47"). '' when missing. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** A mobile number as "+91 90000 00101", however it was saved (with or without +91). '' when missing. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone?.trim()) return '';
  const { dial, national } = splitE164(phone);
  if (!national) return phone.trim();
  // Ten digits read in two fives, as Indian mobiles are written; other lengths stay whole.
  return `+${dial} ${national.length === 10 ? `${national.slice(0, 5)} ${national.slice(5)}` : national}`;
}

/** Phone with the middle hidden: "+91 98•••• 4410". '' when missing. */
export function formatPhoneMasked(phone: string | null | undefined): string {
  if (!phone?.trim()) return '';
  const { dial, national } = splitE164(phone);
  if (!national) return '';
  if (national.length < 8) {
    return `+${dial} ${'•'.repeat(Math.max(national.length - 2, 0))}${national.slice(-2)}`;
  }
  return `+${dial} ${national.slice(0, 2)}${'•'.repeat(national.length - 6)} ${national.slice(-4)}`;
}

/**
 * Short public reference from a UUID — enough to tell same-titled jobs apart.
 * Full id stays in the URL / detail page.
 */
export function shortRef(id: string | null | undefined): string {
  if (!id) return '';
  const compact = id.replace(/-/g, '');
  return compact.slice(0, 8).toUpperCase();
}
