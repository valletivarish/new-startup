import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Segmented, nextIndex, optionText } from './segmented';

describe('nextIndex', () => {
  it('moves with arrows and wraps at both ends', () => {
    expect(nextIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextIndex('ArrowDown', 2, 3)).toBe(0);
    expect(nextIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextIndex('ArrowUp', 1, 3)).toBe(0);
  });

  it('jumps with Home and End and ignores other keys', () => {
    expect(nextIndex('Home', 2, 3)).toBe(0);
    expect(nextIndex('End', 0, 3)).toBe(2);
    expect(nextIndex('Enter', 1, 3)).toBeNull();
    expect(nextIndex('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('Segmented', () => {
  const render = (value: string) =>
    renderToStaticMarkup(
      createElement(Segmented, {
        label: 'Filter jobs',
        value,
        onValueChange: () => {},
        options: [
          { value: 'open', label: 'Open', count: 4 },
          { value: 'draft', label: 'Draft' },
        ],
      }),
    );

  it('is a named radio group where only the checked option takes Tab', () => {
    const html = render('draft');
    expect(html).toContain('role="radiogroup" aria-label="Filter jobs"');
    expect(html).toMatch(/role="radio" aria-checked="false" tabindex="-1"[^>]*><span>Open<\/span> <span[^>]*>4<\/span>/);
    expect(html).toMatch(/role="radio" aria-checked="true" tabindex="0"[^>]*><span>Draft<\/span><\/button>/);
  });

  it('keeps the first option reachable when the value matches none', () => {
    expect(render('closed')).toMatch(/aria-checked="false" tabindex="0"[^>]*><span>Open/);
  });
});

describe('Segmented on a phone', () => {
  it('collapses to a named native select below the breakpoint, counts after a dot', () => {
    const html = renderToStaticMarkup(
      createElement(Segmented, {
        label: 'Filter by decision',
        value: 'all',
        onValueChange: () => {},
        collapseBelow: 'lg',
        options: [
          { value: 'all', label: 'All', count: 7 },
          { value: 'reviewed', label: 'Moved forward', count: null },
        ],
      }),
    );
    expect(html).toMatch(/role="radiogroup"[^>]*class="[^"]*max-lg:hidden/);
    expect(html).toMatch(/class="[^"]*lg:hidden[^"]*"><select[^>]*aria-label="Filter by decision"/);
    expect(html).toContain('>All · 7</option>');
    expect(html).toContain('>Moved forward</option>');
    expect(optionText({ value: 'x', label: 'On hold', count: 0 })).toBe('On hold · 0');
  });
});
