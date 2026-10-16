/** /v1 calls are placed only between 09:00 and 20:00 Asia/Kolkata (IST, UTC+05:30, no DST). */

const IST_OFFSET_MS = 330 * 60_000;
const hourIn = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  hourCycle: 'h23',
});

/** Midnight IST of the IST calendar day containing `t`, as a UTC instant. */
export function istMidnight(t: Date): Date {
  const day = Math.floor((t.getTime() + IST_OFFSET_MS) / 86_400_000);
  return new Date(day * 86_400_000 - IST_OFFSET_MS);
}

/** null inside [09:00, 20:00) IST; otherwise the next 09:00 IST. */
export function nextCallingTime(now: Date): Date | null {
  const hour = Number(hourIn.format(now));
  if (hour >= 9 && hour < 20) return null;
  const nineToday = new Date(istMidnight(now).getTime() + 9 * 3_600_000);
  return hour < 9 ? nineToday : new Date(nineToday.getTime() + 86_400_000);
}
