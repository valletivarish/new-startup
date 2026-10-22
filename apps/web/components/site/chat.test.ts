import { describe, expect, it } from 'vitest';
import { afterWake, answerFor } from './chat';

describe('answerFor', () => {
  it('states the published price', () => {
    const cost = answerFor('How much does it cost?')?.answer ?? '';
    expect(cost).toContain('₹20 per completed call');
    expect(cost).toContain('18% GST');
    expect(cost).not.toMatch(/agree the price/i);
  });

  it('sends typed questions to the answer a visitor expects', () => {
    const cases: [string, string | null][] = [
      ['How does it work?', 'how'],
      ['How much does it cost?', 'cost'],
      ["What's the price per call", 'cost'],
      ['How do I get started', 'start'],
      ['Do I need a SIM card?', 'line'],
      ['Does it speak Hindi?', 'language'],
      ['Can I speak to a human?', 'person'],
      ['Will it reject candidates?', 'decide'],
      ['Is my data safe', 'data'],
      ['Who has access to recordings?', 'data'],
      ["What if they don't answer", 'missed'],
      ['Does it answer candidate questions?', 'how'],
      ['Can it integrate with Zoho Recruit', 'ats'],
      ['Can I upload resumes', 'ats'],
      ['Do candidates need an app?', 'candidate'],
      ['Can it do appointment reminders', 'other'],
      ['Is the transcript accurate', 'accuracy'],
      ['hi', 'hello'],
      ['Tell me about hiring', null],
      ['asdf qwerty', null],
    ];
    for (const [question, id] of cases) expect([question, answerFor(question)?.id ?? null]).toEqual([question, id]);
  });

  it('hears the wake phrase the ways speech recognition writes it, and keeps what follows', () => {
    expect(afterWake('hey helper how much does it cost')).toBe('how much does it cost');
    expect(afterWake('Hey helper')).toBe('');
    expect(afterWake('Hi, helper. Does it speak Hindi?')).toBe('Does it speak Hindi?');
    for (const heard of ['okay helper', 'hello helper', 'Helper'])
      expect(afterWake(`${heard} what does it cost`)).toBe('what does it cost');
    expect(afterWake('they helper')).toBeNull();
    expect(afterWake('it is a helpful tool')).toBeNull();
    expect(afterWake('hey there')).toBeNull();
  });
});
