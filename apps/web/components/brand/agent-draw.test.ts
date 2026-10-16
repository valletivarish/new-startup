import { describe, expect, it } from 'vitest';
import {
  AGENT_COLOURS,
  AGENT_SHAPES,
  agentMarkup,
  voiceLevel,
  type AgentFace,
  type AgentState,
} from './agent-draw';

const STATES: AgentState[] = ['idle', 'ringing', 'listening', 'thinking', 'speaking', 'done', 'missed'];
const FACES: AgentFace[] = ['neutral', 'attentive', 'happy', 'curious', 'wink', 'surprised', 'proud', 'sleepy'];
const count = (markup: string, tag: string) => markup.split(`<${tag} `).length - 1;

describe('agentMarkup', () => {
  it('never writes NaN or Infinity, for every shape, colour, face and state, still or moving', () => {
    for (const shape of Object.keys(AGENT_SHAPES) as (keyof typeof AGENT_SHAPES)[])
      for (const colour of Object.keys(AGENT_COLOURS) as (keyof typeof AGENT_COLOURS)[])
        for (const face of FACES)
          for (const state of STATES)
            for (const t of [0, 0.05, 1.3, 4.25, 9.9])
              for (const still of [true, false]) {
                const markup = agentMarkup({ shape, colour, face, state, still, look: { x: 0.4, y: -0.7 }, seed: 1.1 }, t);
                expect(markup).not.toMatch(/NaN|Infinity/);
              }
  });

  it('acts out the call: five bars speaking, three dots thinking, a tick when done', () => {
    const base = { shape: 'pebble', colour: 'pearl', face: 'neutral' } as const;
    expect(count(agentMarkup({ ...base, state: 'speaking' }, 2), 'rect')).toBe(5);
    expect(count(agentMarkup({ ...base, state: 'thinking' }, 2), 'circle')).toBe(3);
    expect(agentMarkup({ ...base, state: 'done', still: true }, 0)).toContain('M37 49L46 57L64 39');
    expect(agentMarkup({ ...base, state: 'missed', still: true }, 0)).toContain('>z<');
  });

  it('keeps the voice level between 0 and 1', () => {
    for (let t = 0; t < 30; t += 0.07) {
      const level = voiceLevel(t);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });
});
