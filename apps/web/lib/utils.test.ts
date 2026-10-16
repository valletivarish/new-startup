import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('keeps token text sizes and radii beside colours', () => {
    expect(cn('text-label text-ink')).toBe('text-label text-ink');
    expect(cn('rounded-control border-line')).toBe('rounded-control border-line');
  });

  it('still lets a later size or radius win', () => {
    expect(cn('text-body', 'text-meta')).toBe('text-meta');
    expect(cn('rounded-strip', 'rounded-sheet')).toBe('rounded-sheet');
    expect(cn('rounded-button', 'rounded-pill')).toBe('rounded-pill');
    expect(cn('rounded-card-sm', 'rounded-[10px]')).toBe('rounded-[10px]');
  });

  it('lets a later width role, duration, easing or animation win', () => {
    expect(cn('stretch-strip', 'stretch-read')).toBe('stretch-read');
    expect(cn('duration-fast', 'duration-slow')).toBe('duration-slow');
    expect(cn('ease-standard', 'ease-exit')).toBe('ease-exit');
    expect(cn('animate-fade-in', 'animate-stamp')).toBe('animate-stamp');
    expect(cn('stretch-strip text-ink duration-fast')).toBe('stretch-strip text-ink duration-fast');
  });
});
