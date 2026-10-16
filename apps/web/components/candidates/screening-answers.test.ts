import { describe, expect, it } from 'vitest';
import {
  callStatusLabel,
  formatCallDuration,
  sessionListMeta,
} from './screening-answers';

const QUESTIONS = [
  { id: 'java', label: 'How many years have you worked with Java?' },
  { id: 'spring', label: 'Describe a Spring Boot service you built.' },
] as const;

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
