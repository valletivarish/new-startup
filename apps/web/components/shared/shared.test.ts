import * as React from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup as html } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { agentStateFor } from './agent-state';
import { answerCoverage, AnswersList, type Answer } from './answers-list';
import { ListeningBar } from './listening-bar';
import { LiveCallStrip } from './live-call-strip';
import { OriginTicket } from './origin-ticket';
import {
  currentTurnIndex,
  formatTurnTime,
  spokenTime,
  toTranscriptTurns,
  Transcript,
  TranscriptCard,
} from './transcript';
import { initials, initialsTone } from './user-initials';

// ponytail: vitest compiles TSX with the classic runtime, so components need React in scope
// (same shim as components/ui/strip-board.test.ts).
Object.assign(globalThis, { React });

describe('transcript times', () => {
  it('formats times into the call as m:ss, floored, and blank when unknown', () => {
    expect(formatTurnTime(0)).toBe('0:00');
    expect(formatTurnTime(134.9)).toBe('2:14');
    expect(formatTurnTime(600)).toBe('10:00');
    expect(formatTurnTime(null)).toBe('');
    expect(formatTurnTime(undefined)).toBe('');
  });

  it('says times in words for screen readers', () => {
    expect(spokenTime(134)).toBe('2 minutes 14 seconds');
    expect(spokenTime(61)).toBe('1 minute 1 second');
    expect(spokenTime(120)).toBe('2 minutes');
    expect(spokenTime(5.7)).toBe('5 seconds');
  });

  it('picks the last turn that has started, skipping turns without a time', () => {
    const turns = [{ at: 3 }, { at: 9 }, { at: null }, { at: 20 }];
    expect(currentTurnIndex(turns, undefined)).toBe(-1);
    expect(currentTurnIndex(turns, 1)).toBe(-1);
    expect(currentTurnIndex(turns, 8.8)).toBe(1); // a seek that lands a frame early
    expect(currentTurnIndex(turns, 19)).toBe(1);
    expect(currentTurnIndex(turns, 400)).toBe(3);
  });

  it('maps API turns, keeping missing times missing', () => {
    expect(
      toTranscriptTurns(
        [
          { role: 'agent', message: 'Hello', timeInCallSecs: 0 },
          { role: 'user', message: 'Hi' },
        ],
        'Priya',
      ),
    ).toEqual([
      { speaker: 'agent', name: undefined, at: 0, text: 'Hello' },
      { speaker: 'contact', name: 'Priya', at: null, text: 'Hi' },
    ]);
    expect(toTranscriptTurns(null)).toEqual([]);
  });

  it('turns each time into a Play from button when a recording exists, never the turn itself', () => {
    const turns = [
      { speaker: 'agent' as const, at: 0, text: 'What is your notice period?' },
      { speaker: 'contact' as const, name: 'Priya', at: 4, text: 'Thirty days.' },
    ];
    const out = html(h(Transcript, { turns, currentTime: 5, onPlayFrom: () => {} }));
    expect(out.match(/<button/g)).toHaveLength(2);
    // Label in name: the visible time is part of it.
    expect(out).toContain('aria-label="Play from 0:04"');
    expect(out).toContain('</svg>0:04</button>');
    // The speaker is read before the words.
    expect(out).toContain('<span class="sr-only">Priya: </span>Thirty days.</p>');
    expect(out.match(/aria-current="true"/g)).toHaveLength(1);
    expect(out).not.toContain('tabindex');
    const plain = html(h(Transcript, { turns }));
    expect(plain).not.toContain('<button');
    expect(plain).toContain('<time dateTime="PT4S">0:04</time>');
  });

  it('keeps a tab stop on the scroll box when no turn has a Play button', () => {
    const untimed = [{ speaker: 'contact' as const, at: null, text: 'Hello.' }];
    const out = html(h(Transcript, { turns: untimed, onPlayFrom: () => {} }));
    expect(out).not.toContain('<button');
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('>Candidate</span>');
    expect(html(h(Transcript, { turns: untimed, contactLabel: 'Applicant' }))).toContain('>Applicant</span>');
  });

  it('frames a card on canvas or glass, with no box inside the card', () => {
    const turns = [{ speaker: 'agent' as const, at: 0, text: 'Hello.' }];
    const canvas = html(h(TranscriptCard, { title: 'Hiring agent', turns }));
    expect(canvas).toContain('rounded-card border border-border bg-canvas');
    expect(canvas).not.toContain('rounded-card-sm border border-border bg-canvas p-3');
    const glass = html(h(TranscriptCard, { title: 'Hiring agent', variant: 'glass', turns }));
    expect(glass).toContain('glass rounded-canvas');
    expect(glass).toContain('mask-image');
  });
});

describe('listening bar', () => {
  it('says the state in words, times the call, and announces changes only when asked', () => {
    const out = html(h(ListeningBar, { state: 'listening', seconds: 70.6 }));
    expect(out).toContain('role="status"');
    expect(out).toContain('Listening…');
    expect(out).toContain('<time dateTime="PT70S">1:10</time>');
    const quiet = html(h(ListeningBar, { state: 'speaking', announce: false }));
    expect(quiet).not.toContain('role="status"');
    expect(quiet).toContain('Speaking');
    expect(quiet).not.toContain('<time');
  });

  it('moves the bars only while active, and never under reduced motion', () => {
    expect(html(h(ListeningBar, { state: 'speaking' }))).toContain('motion-safe:animate-listening-bar');
    expect(html(h(ListeningBar, { state: 'speaking', active: false }))).not.toContain('animate-listening-bar');
  });
});

describe('answers', () => {
  const items: Answer[] = [
    { question: 'Notice period', answer: 'Thirty days', at: 134 },
    { question: 'Expected salary', answer: null },
    { question: 'Current location', answer: '   ' },
    { question: 'Relocation', answer: 'Open to Pune', extra: true },
  ];

  it('counts coverage over the job questions only, not extras or blanks', () => {
    expect(answerCoverage(items)).toEqual({ answered: 1, total: 3 });
    expect(answerCoverage([])).toEqual({ answered: 0, total: 0 });
  });

  it('shows Not answered plainly, extras under Also mentioned, and seekable time pills', () => {
    const out = html(h(AnswersList, { items, onSeek: () => {} }));
    expect(out).toContain('1 of 3 questions answered');
    expect(out.match(/Not answered/g)).toHaveLength(2);
    expect(out).not.toContain('>Answered<');
    expect(out).toContain('Also mentioned');
    expect(out).toContain('aria-label="Jump to 2:14 in the call"');
  });

  it('names the time pill with its visible time (label in name)', () => {
    const out = html(h(OriginTicket, { at: 134, onSeek: () => {} }));
    expect(out).toContain('aria-label="Jump to 2:14 in the call"');
    expect(out).toContain('>2:14</button>');
  });
});

describe('live call card', () => {
  it('reads the state with the name, and offers only the actions that can work', () => {
    const live = html(h(LiveCallStrip, { name: 'Asha Rao', state: 'active', onEnd: () => {} }));
    expect(live).toContain('role="status"');
    expect(live).toContain('<span class="sr-only">Asha Rao: </span>');
    expect(live).toContain('End call');
    const failed = { name: 'Asha Rao', state: 'failed', onRetry: () => {} };
    expect(html(h(LiveCallStrip, { ...failed, failureReason: 'no_answer' }))).toContain('Call again');
    expect(html(h(LiveCallStrip, { ...failed, failureReason: 'invalid_number' }))).not.toContain('Call again');
  });
});

describe('agent state', () => {
  it('acts out the real call: ringing, listening, writing up, done, missed', () => {
    expect(agentStateFor('dialing')).toBe('ringing');
    expect(agentStateFor('active')).toBe('listening');
    expect(agentStateFor('speaking')).toBe('speaking');
    expect(agentStateFor('results_pending')).toBe('thinking');
    expect(agentStateFor('ready_for_review')).toBe('done');
    expect(agentStateFor('completed')).toBe('done');
    expect(agentStateFor('no_answer')).toBe('missed');
    expect(agentStateFor('carrier_blocked')).toBe('missed');
    expect(agentStateFor('failed')).toBe('missed');
  });

  it('stays idle before a call and for anything it does not know', () => {
    expect(agentStateFor('not_called')).toBe('idle');
    expect(agentStateFor(null)).toBe('idle');
    expect(agentStateFor('toString')).toBe('idle');
    expect(agentStateFor('something_new')).toBe('idle');
  });
});

describe('initials', () => {
  it('takes the first letters of the first and last words', () => {
    expect(initials('Priya Sharma')).toBe('PS');
    expect(initials('  ravi  kumar  reddy ')).toBe('RR');
    expect(initials('Asha')).toBe('A');
    expect(initials('')).toBe('');
    expect(initials(null)).toBe('');
  });

  it('gives a name the same tint every time, and spreads names across tints', () => {
    expect(initialsTone('Priya Sharma')).toBe(initialsTone('  priya sharma '));
    const names = ['Priya Sharma', 'Rahul Verma', 'Asha Rao', 'Arjun Nair', 'Kavya Menon', 'Neha Gupta', 'Farah Ali'];
    expect(new Set(names.map(initialsTone)).size).toBeGreaterThan(2);
  });
});
