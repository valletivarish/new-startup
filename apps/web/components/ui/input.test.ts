import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h, type ReactElement } from 'react';
import {
  Field,
  Input,
  SearchInput,
  Select,
  describeAccept,
  fieldIds,
  formatBytes,
  validateFiles,
  type FieldProps,
} from './input';

const file = (name: string, size = 1000, type = '') => ({ name, size, type });
const MB = 1024 * 1024;
const DOCS = '.pdf,.docx,.pptx,.txt,.md,application/pdf,text/plain';

describe('fieldIds', () => {
  it('links hint and error after any ids the control already had', () => {
    expect(fieldIds('f', { hint: true, error: true, describedBy: 'own' })).toEqual({
      controlId: 'f-control',
      hintId: 'f-hint',
      errorId: 'f-error',
      describedBy: 'own f-hint f-error',
    });
  });

  it('keeps an existing control id and leaves describedby unset when nothing describes it', () => {
    const ids = fieldIds('f', { id: 'email' });
    expect(ids.controlId).toBe('email');
    expect(ids.describedBy).toBeUndefined();
  });
});

describe('Field', () => {
  const render = (props: Partial<FieldProps>, child: ReactElement = h(Input)) =>
    renderToStaticMarkup(h(Field, { label: 'Work email', ...props, children: child }));
  const attr = (html: string, name: string) => html.match(new RegExp(`<input[^>]* ${name}="([^"]*)"`))?.[1];

  it('labels the control through its id, with the hint outside the label and below the control', () => {
    const html = render({ hint: 'We send the invite here.' });
    const id = attr(html, 'id');
    expect(html).toContain(`<label for="${id}"`);
    expect(html).toMatch(/<\/label><input[^>]*><p id="[^"]+-hint"/);
    expect(attr(html, 'aria-describedby')).toMatch(/-hint$/);
    expect(attr(html, 'aria-invalid')).toBeUndefined();
  });

  it('marks the control invalid and announces the error right under it, above the hint', () => {
    const html = render({ hint: 'h', error: 'Enter an email address.' });
    expect(attr(html, 'aria-invalid')).toBe('true');
    expect(attr(html, 'aria-describedby')).toMatch(/-hint \S+-error$/);
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/<input[^>]*><p id="[^"]+-error"[^>]*>.*Enter an email address\.<\/p><p id="[^"]+-hint"/);
  });

  it('can show an error without role=alert while typing', () => {
    expect(render({ error: 'Too short.', announce: false })).not.toContain('role="alert"');
  });

  it('uses an id the control already has', () => {
    const html = render({}, h(Input, { id: 'email' }));
    expect(html).toContain('<label for="email"');
  });

  it('labels a SearchInput the same way, with its key hint hidden from screen readers', () => {
    const html = render({ label: 'Search jobs' }, h(SearchInput, { shortcut: '⌘K' }));
    const id = attr(html, 'id');
    expect(html).toContain(`<label for="${id}"`);
    expect(attr(html, 'type')).toBe('search');
    expect(html).toMatch(/<kbd[^>]* aria-hidden="true"[^>]*>⌘K<\/kbd>/);
  });
});

describe('Select height', () => {
  const selectClass = (html: string) => html.match(/<select[^>]* class="([^"]*)"/)?.[1] ?? '';
  const select = h(Select, { 'aria-label': 'Show calls for' }, h('option', null, 'All jobs'));

  it('is a 44px form field in a Field, as tall as the inputs around it', () => {
    const html = renderToStaticMarkup(h(Field, { label: 'Access level', children: select }));
    expect(selectClass(html)).toMatch(/(^| )h-11( |$)/);
  });

  it('is 40px in a filter row, 44px under a finger', () => {
    const cls = selectClass(renderToStaticMarkup(select));
    expect(cls).toMatch(/(^| )h-10( |$)/);
    expect(cls).toContain('[@media(pointer:coarse)]:h-11');
  });
});

describe('validateFiles', () => {
  it('accepts by extension even when the browser gives no type', () => {
    expect(validateFiles([file('Notes.MD')], { accept: DOCS })).toEqual({
      accepted: [file('Notes.MD')],
      error: null,
    });
  });

  it('accepts by exact and wildcard MIME type', () => {
    expect(validateFiles([file('scan', 10, 'application/pdf')], { accept: DOCS }).error).toBeNull();
    expect(validateFiles([file('photo', 10, 'image/png')], { accept: 'image/*' }).error).toBeNull();
  });

  it('refuses a file the accept list does not cover, in plain words', () => {
    expect(validateFiles([file('budget.xlsx')], { accept: DOCS })).toEqual({
      accepted: [],
      error: 'budget.xlsx isn’t a file this accepts. Use PDF, DOCX, PPTX, TXT or MD.',
    });
  });

  it('refuses a file over maxBytes', () => {
    expect(validateFiles([file('cv.pdf', 14.2 * MB)], { accept: DOCS, maxBytes: 10 * MB }).error).toBe(
      'cv.pdf is 14.2 MB. Files can be up to 10 MB.',
    );
  });

  it('keeps the good files and counts the other refusals', () => {
    const { accepted, error } = validateFiles(
      [file('a.pdf'), file('b.exe'), file('c.zip'), file('d.txt')],
      { accept: DOCS },
    );
    expect(accepted.map((f) => f.name)).toEqual(['a.pdf', 'd.txt']);
    expect(error).toBe(
      'b.exe isn’t a file this accepts. Use PDF, DOCX, PPTX, TXT or MD. 1 other file was also left out.',
    );
  });

  it('takes anything when there are no rules', () => {
    expect(validateFiles([file('x.bin', 50 * MB)], {}).error).toBeNull();
  });
});

describe('describeAccept and formatBytes', () => {
  it('reads accept lists and sizes the way a person would say them', () => {
    expect(describeAccept('.csv,text/csv')).toBe('CSV');
    expect(describeAccept('text/plain')).toBeNull();
    expect(formatBytes(10 * MB)).toBe('10 MB');
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(12)).toBe('12 bytes');
  });
});
