import { describe, expect, it } from 'vitest';
import {
  callStatusLabel,
  formatCallDuration,
  answerItems,
  hasPlayableRecording,
  sessionListMeta,
} from './screening-answers';
import { answerCoverage } from '../shared/answers-list';

const QUESTIONS = [
  { id: 'java', label: 'How many years have you worked with Java?' },
  { id: 'spring', label: 'Describe a Spring Boot service you built.' },
] as const;

describe('hasPlayableRecording', () => {
  it('asks for audio only when the call ended, ran, and the server says it kept one', () => {
    const ended = { recordingAvailable: true, status: 'ended', durationSeconds: 42 };
    expect(hasPlayableRecording(ended)).toBe(true);
    expect(hasPlayableRecording({ ...ended, recordingAvailable: false })).toBe(false);
    expect(hasPlayableRecording({ ...ended, recordingAvailable: undefined })).toBe(false);
    expect(hasPlayableRecording({ ...ended, status: 'active' })).toBe(false);
    expect(hasPlayableRecording({ ...ended, status: 'failed' })).toBe(false);
    expect(hasPlayableRecording({ ...ended, durationSeconds: 0 })).toBe(false);
    expect(hasPlayableRecording({ ...ended, durationSeconds: null })).toBe(false);
  });
});

describe('sessionListMeta', () => {
  it('keeps list cards to status, duration, and answered count', () => {
    const meta = sessionListMeta(
      {
        status: 'completed',
        startedAt: '2026-09-18T11:22:50.000Z',
        durationSeconds: 14,
        structuredAnswers: { java: 'voicemail' },
        transcript: [
          { role: 'agent', message: 'Hello' },
          { role: 'user', message: 'Hi' },
        ],
        recordingAvailable: true,
        summary: 'Reached voicemail.',
      },
      QUESTIONS,
    );
    expect(meta.statusLabel).toBe('Completed');
    expect(meta.durationLabel).toBe('0:14');
    expect(meta.answeredLabel).toBe('1 of 2 answered');
    expect(meta.turnCount).toBe(2);
    expect(meta.hasRecording).toBe(true);
    expect(meta.hasSummary).toBe(true);
    expect(meta.when.length).toBeGreaterThan(0);
    expect(JSON.stringify(meta)).not.toContain('Reached voicemail');
  });

  it('labels in-progress screens without inventing answers', () => {
    const meta = sessionListMeta(
      {
        status: 'active',
        durationSeconds: null,
        structuredAnswers: null,
        transcript: null,
      },
      QUESTIONS,
    );
    expect(meta.statusLabel).toBe('In progress');
    expect(meta.durationLabel).toBeNull();
    expect(meta.answeredLabel).toBe('0 of 2 answered');
    expect(meta.turnCount).toBe(0);
  });

  it('counts a question as answered only when something was said, same as the Answers list', () => {
    const answers = { java: '5 years', spring: null, notice: '' };
    const questions = [...QUESTIONS, { id: 'notice', label: 'Notice period?' }];
    const meta = sessionListMeta(
      { status: 'ended', structuredAnswers: answers, transcript: null },
      questions,
    );
    const { answered, total } = answerCoverage(answerItems(answers, questions));
    expect(meta.answeredLabel).toBe('1 of 3 answered');
    expect(meta.answeredLabel).toBe(`${answered} of ${total} answered`);
  });
});

describe('call length', () => {
  it('never shows 0:00 for a call that never connected', () => {
    const meta = sessionListMeta({ status: 'failed', durationSeconds: 0, structuredAnswers: null, transcript: null }, QUESTIONS);
    expect(meta.durationLabel).toBeNull();
  });
});

describe('callStatusLabel', () => {
  it('maps ended and completed to Completed', () => {
    expect(callStatusLabel('ended')).toBe('Completed');
    expect(callStatusLabel('completed')).toBe('Completed');
  });

  it('falls back to Call when status is missing', () => {
    expect(callStatusLabel(null)).toBe('Call');
    expect(formatCallDuration(75)).toBe('1:15');
  });
});
