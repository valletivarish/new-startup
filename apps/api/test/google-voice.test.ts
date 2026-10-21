import { describe, it, expect } from 'vitest';
import { googleVoiceId, screeningLanguageOf } from '../src/providers/elevenlabs/voice-session.service.js';

describe('Google voice id', () => {
  it('is <lang>-IN-Chirp3-HD-<Persona>, Kore unless iapetus', () => {
    expect(googleVoiceId('en', 'kore')).toBe('en-IN-Chirp3-HD-Kore');
    expect(googleVoiceId('te', 'iapetus')).toBe('te-IN-Chirp3-HD-Iapetus');
    expect(googleVoiceId('hi', 'unknown')).toBe('hi-IN-Chirp3-HD-Kore');
  });

  it('maps a language tag to one of the 11 launch codes, else English', () => {
    expect(screeningLanguageOf('en-IN')).toBe('en');
    expect(screeningLanguageOf('hi')).toBe('hi');
    expect(screeningLanguageOf('ta-IN')).toBe('ta');
    expect(screeningLanguageOf('PA')).toBe('pa');
    expect(screeningLanguageOf('or-IN')).toBe('en');
  });
});
