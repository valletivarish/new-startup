import * as React from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { PersonStateTag, personState } from './person-state';

// Vitest compiles TSX with the classic runtime (same shim as components/shared/shared.test.ts).
Object.assign(globalThis, { React });

describe('personState', () => {
  it('puts a live call first, then decisions, then what waits on you', () => {
    expect(personState('reviewed', 'calling')).toBe('calling');
    expect(personState('reviewed', 'completed')).toBe('decided');
    expect(personState('declined', 'failed')).toBe('decided');
    expect(personState('screening', 'completed')).toBe('review');
    expect(personState('new', 'failed')).toBe('retry');
    expect(personState('screening', 'not_called')).toBe('hold');
    expect(personState('new', 'not_called')).toBe('new');
    expect(personState('new', null)).toBe('new');
  });

  it('never shows two words for one person', () => {
    const client = new QueryClient();
    const tag = (stage: string, callStatus: string, failureReason?: string) =>
      renderToStaticMarkup(
        h(QueryClientProvider, { client }, h(PersonStateTag, { stage, callStatus, failureReason })),
      );
    expect(tag('new', 'completed')).toContain('Ready for review');
    expect(tag('new', 'completed')).not.toContain('Not called yet');
    expect(tag('screening', 'not_called')).toContain('On hold');
    expect(tag('reviewed', 'completed')).toContain('Moved forward');
    expect(tag('new', 'failed')).toContain('Call didn’t connect');
    expect(tag('new', 'failed', 'no_answer')).toContain('No answer');
  });
});
