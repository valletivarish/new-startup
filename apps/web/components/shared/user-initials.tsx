import { UserRound } from 'lucide-react';
import { cn } from '../ui/cn';

/** "Priya Sharma" gives "PS": first letters of the first and last words. '' when there is no name. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = (word: string | undefined) => (word ? Array.from(word)[0] ?? '' : '');
  const last = words.length > 1 ? first(words[words.length - 1]) : '';
  return (first(words[0]) + last).toLocaleUpperCase();
}

// Soft tints from the token palette, each with its own border and text (all AA). Amber and red
// are left out so an avatar never reads as a warning or an error.
const NEUTRAL = 'border-status-neutral-border bg-status-neutral-bg text-status-neutral-text';
const TONES: readonly string[] = [
  'border-status-info-border bg-status-info-bg text-status-info-text',
  'border-status-success-border bg-status-success-bg text-status-success-text',
  'border-border bg-accent-soft text-accent',
  NEUTRAL,
];

/** The same name always gets the same tint, on the server and in the browser. Exported for tests. */
export function initialsTone(name: string | null | undefined): string {
  const key = (name ?? '').trim().toLocaleLowerCase();
  if (!key) return NEUTRAL;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return TONES[hash % TONES.length] ?? NEUTRAL;
}

const SIZE = {
  sm: 'size-6 text-caption [&_svg]:size-3.5', // 24
  md: 'size-8 text-caption [&_svg]:size-4', // 32
  lg: 'size-10 text-label [&_svg]:size-5', // 40
} as const;

/** A round avatar with the initials on a tint picked from the name. Decorative: the surrounding control carries the name. */
export function UserInitials({
  name,
  size = 'md',
  className,
}: {
  name: string | null | undefined;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const text = initials(name);
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full border font-semibold',
        initialsTone(text ? name : null),
        SIZE[size],
        className,
      )}
    >
      {text || <UserRound aria-hidden strokeWidth={1.5} />}
    </span>
  );
}
