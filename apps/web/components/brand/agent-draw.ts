/**
 * The voice agent's character as SVG: a pebble of sky glass with a face that acts out the call.
 * Inspired by bloub's morphing avatars; ours has two ideas of its own. It is made of the same
 * glass as the website (highlights, darker edges, light gathering at the foot, a grass-green
 * bounce), and its eyes are a voice meter: they stretch into sound bars when it speaks (and
 * the glass glows with the voice), become dots when it thinks and a tick when the call is done.
 *
 * Pure, so the server draws the first frame and the client redraws only what moves
 * (components/brand/agent.tsx). ViewBox 0 0 100 100; rings, sound arcs and sparkles may draw a
 * little outside it, so the host svg keeps overflow visible. Gradients only, no filters: cheap
 * enough to animate several at once.
 */

export type AgentState = 'idle' | 'ringing' | 'listening' | 'thinking' | 'speaking' | 'done' | 'missed';
export type AgentShape = 'pebble' | 'circle' | 'squircle' | 'capsule' | 'droplet' | 'cloud' | 'hexagon';
export type AgentColour = 'pearl' | 'glass' | 'ink' | 'lime' | 'coral' | 'violet' | 'amber' | 'teal';
export type AgentFace = 'neutral' | 'attentive' | 'happy' | 'curious' | 'wink' | 'surprised' | 'proud' | 'sleepy';

export const AGENT_SHAPES: Record<AgentShape, string> = {
  pebble: 'M50 13C72 12 88 28 88 51C88 75 71 90 48 89C26 88 12 73 12 51C12 28 29 14 50 13Z',
  circle: 'M50 12a39 39 0 1 0 0.01 0Z',
  squircle: 'M50 12C81 12 88 19 88 50C88 81 81 88 50 88C19 88 12 81 12 50C12 19 19 12 50 12Z',
  capsule: 'M30 26H70A24 24 0 0 1 70 74H30A24 24 0 0 1 30 26Z',
  droplet: 'M50 8C50 8 85 42 85 61C85 80 69 92 50 92C31 92 15 80 15 61C15 42 50 8 50 8Z',
  cloud: 'M30 82C17 82 9 73 10 62C11 52 19 46 27 47C27 33 37 23 50 23C61 23 70 30 73 40C83 40 91 49 90 60C89 72 80 82 68 82Z',
  hexagon: 'M44 13Q50 10 56 13L82 28Q88 31 88 38V62Q88 69 82 72L56 87Q50 90 44 87L18 72Q12 69 12 62V38Q12 31 18 28Z',
};

/** The glass in four tones, light to dark, plus the eyes and the glow it gives off. */
export interface AgentTones {
  light: string;
  mid: string;
  deep: string;
  dark: string;
  eye: string;
  eyeLift: string;
  glow: string;
}

export const AGENT_COLOURS: Record<AgentColour, AgentTones> = {
  // Pearl, the brand's (founder's pick): white glass that lights up on the sky and the black.
  pearl: { light: '#ffffff', mid: '#f1f4f8', deep: '#cfd8e3', dark: '#9aa7b8', eye: '#0e1116', eyeLift: '#2a3342', glow: '#ffffff' },
  // Sky glass: cut from the hero's sky.
  glass: { light: '#f4fbff', mid: '#9fd0f6', deep: '#3a86d4', dark: '#163f73', eye: '#08182b', eyeLift: '#1f3d61', glow: '#8ec5f2' },
  ink: { light: '#9aa8bd', mid: '#3b4a63', deep: '#19243a', dark: '#090d16', eye: '#ffffff', eyeLift: '#dfe8f5', glow: '#6f8fb8' },
  lime: { light: '#f6ffe2', mid: '#cdf37f', deep: '#8cc63a', dark: '#4b7a19', eye: '#0e1a05', eyeLift: '#2b3d12', glow: '#b4ec51' },
  coral: { light: '#fff1ec', mid: '#ffa98d', deep: '#f0663f', dark: '#9c3216', eye: '#2a0c03', eyeLift: '#5b2414', glow: '#ff9a7a' },
  violet: { light: '#f3f1ff', mid: '#b3a8ff', deep: '#7262ea', dark: '#3a2e9a', eye: '#0f0a2e', eyeLift: '#2d2566', glow: '#a497ff' },
  amber: { light: '#fff8e8', mid: '#ffd47e', deep: '#e9a52c', dark: '#97620c', eye: '#2a1903', eyeLift: '#5a3c0e', glow: '#ffcd6b' },
  teal: { light: '#ecfffb', mid: '#8fe6d8', deep: '#1fb5a0', dark: '#0b6458', eye: '#03211c', eyeLift: '#0d4a40', glow: '#62d8c6' },
};

export interface AgentLook {
  shape: AgentShape;
  colour: AgentColour;
  face: AgentFace;
  state: AgentState;
  /** Where the eyes look, -1 to 1 on each axis. */
  look?: { x: number; y: number };
  /** The pointer is over it: neutral turns happy, the body lifts a little. */
  hover?: boolean;
  /** On a light surface: a soft ground shadow and ink extras. Otherwise it glows and the extras are white. */
  onLight?: boolean;
  /** Offsets this agent's blink from others on the page. */
  seed?: number;
  /** Still drawing: no breathing, blinking or glancing (reduced motion, server frame). */
  still?: boolean;
  /** Body stays put (no breathing, hops, tilts, rings or arcs); only the eyes move. */
  fixed?: boolean;
  /**
   * Logo sizes (about 40px and under): no darkened edge (it reads as a ring when tiny), a
   * softer glow and slightly larger eyes. Icons need their own small version; so does this.
   */
  small?: boolean;
}

/** Loudness from 0 to 1 with syllables and pauses, so speaking reads as speech, not a sine. */
export function voiceLevel(t: number): number {
  const s = Math.max(0, Math.sin(t * 9.4) * 0.55 + Math.sin(t * 3.3 + 1.1) * 0.5 + Math.sin(t * 16.1) * 0.22);
  return Math.min(1, s * ((Math.sin(t * 0.85) + 1) / 2 > 0.2 ? 1 : 0.12));
}

const r1 = (n: number) => Math.round(n * 10) / 10;

type Pt = { x: number; y: number };

function eyes(face: AgentFace, id: string, look: Pt, blink: number): string {
  const fill = `url(#${id}-eye)`;
  const stroke = `url(#${id}-eye)`;
  const L = { x: 39 + look.x, y: 47 + look.y };
  const R = { x: 61 + look.x, y: 47 + look.y };
  // A glossy eye: the pill, and a small catchlight near its top.
  const pill = (c: Pt, w: number, h: number, rot = 0) =>
    `<g transform="rotate(${rot} ${r1(c.x)} ${r1(c.y)})"><rect x="${r1(c.x - w / 2)}" y="${r1(c.y - h / 2)}" width="${w}" height="${r1(h)}" rx="${w / 2}" fill="${fill}"/>${
      h > 6 ? `<ellipse cx="${r1(c.x - w * 0.12)}" cy="${r1(c.y - h * 0.26)}" rx="${r1(w * 0.2)}" ry="${r1(Math.min(2.4, h * 0.12))}" fill="#ffffff" opacity="0.85"/>` : ''
    }</g>`;
  const arc = (c: Pt, up: boolean) =>
    `<path d="M${r1(c.x - 6)} ${r1(c.y + (up ? 3 : -2))}Q${r1(c.x)} ${r1(c.y + (up ? -6 : 5))} ${r1(c.x + 6)} ${r1(c.y + (up ? 3 : -2))}" stroke="${stroke}" stroke-width="3.8" stroke-linecap="round" fill="none"/>`;
  const line = (c: Pt) => `<path d="M${r1(c.x - 6)} ${r1(c.y + 1)}H${r1(c.x + 6)}" stroke="${stroke}" stroke-width="3.6" stroke-linecap="round"/>`;
  const h = (n: number) => Math.max(1.2, n * blink);
  switch (face) {
    case 'attentive':
      return pill(L, 9, h(12)) + pill(R, 9, h(12));
    case 'happy':
      return arc(L, true) + arc(R, true);
    case 'curious':
      return pill(L, 7, h(12)) + pill({ x: R.x, y: R.y - 2 }, 7, h(18));
    case 'wink':
      return pill(L, 7, h(16)) + arc(R, true);
    case 'surprised': {
      const r = r1(5.6 * Math.max(0.2, blink));
      return [L, R]
        .map((c) => `<circle cx="${r1(c.x)}" cy="${r1(c.y)}" r="${r}" fill="${fill}"/><circle cx="${r1(c.x - 1.6)}" cy="${r1(c.y - 2)}" r="${r1(r * 0.3)}" fill="#ffffff" opacity="0.85"/>`)
        .join('');
    }
    case 'proud':
      return arc({ x: L.x, y: L.y + 2 }, false) + arc({ x: R.x, y: R.y + 2 }, false);
    case 'sleepy':
      return line(L) + line(R);
    default:
      return pill(L, 7, h(16), 12) + pill(R, 7, h(16), 12);
  }
}

/** The parts that move each frame. agent.tsx writes these into the live svg. */
export interface AgentFrame {
  /** Transform of the body group (breathing, hops, wiggles, hover lift). */
  body: string;
  /** The face: eyes, voice meter, dots, tick. */
  face: string;
  /** Rings, sound arcs, "z"s and sparkles around it. */
  extra: string;
  /** Opacity of the voice glow inside the glass. */
  voice: number;
  /** Width scale of the ground shadow or glow under it (it shrinks while hopping). */
  ground: number;
  /** Opacity of the glow on the side the voice comes from, while it listens. */
  ear: number;
}

// Ringing keeps a real phone's rhythm: two rings, then a pause (the Indian ringback cadence).
const RING_CYCLE = 2.6;
const RING_STARTS = [0, 0.55];
const RING_LEN = 0.42;
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeInOut = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);

/** A repeatable random number in [0, 1) for slot n of the agent with this seed. */
function hash(n: number, seed: number): number {
  const x = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

type IdleMove = 'rest' | 'glance' | 'blink2' | 'wink' | 'curious' | 'hop' | 'think' | 'lookUp';
const IDLE_SLOT = 3.4;
// How long each move lasts, in seconds.
const IDLE_LENGTH: Record<IdleMove, number> = { rest: 0, glance: 1.3, blink2: 0.34, wink: 0.6, curious: 1.4, hop: 0.7, think: 1.2, lookUp: 1.1 };

/** What a waiting agent is doing at time t: one small move per slot, at an irregular moment. */
function idleMove(t: number, seed: number): { move: IdleMove; p: number; env: number; r: number } {
  const slot = Math.floor(t / IDLE_SLOT);
  const local = t - slot * IDLE_SLOT;
  const pick = hash(slot * 7 + 1, seed);
  const move: IdleMove =
    pick < 0.32 ? 'rest' : pick < 0.48 ? 'glance' : pick < 0.58 ? 'blink2' : pick < 0.66 ? 'wink' : pick < 0.76 ? 'curious' : pick < 0.86 ? 'hop' : pick < 0.94 ? 'think' : 'lookUp';
  const p = local - (0.3 + hash(slot * 7 + 2, seed) * 1.2);
  const len = IDLE_LENGTH[move];
  if (move === 'rest' || p < 0 || p >= len) return { move: 'rest', p: 0, env: 0, r: 0 };
  // Eases in over 0.18s and out over the last 0.22s: anticipation and settle.
  const env = Math.min(1, p / 0.18, (len - p) / 0.22);
  return { move, p, env: easeInOut(Math.max(0, env)), r: hash(slot * 7 + 3, seed) };
}

/** Time since the ring that is sounding now, or null between rings. */
function ringing(t: number): number | null {
  const c = ((t % RING_CYCLE) + RING_CYCLE) % RING_CYCLE;
  for (const start of RING_STARTS) if (c >= start && c < start + RING_LEN) return c - start;
  return null;
}

/** An arc of a circle round the agent's middle, on the right (side 1) or left (side -1). */
function sideArc(r: number, side: 1 | -1, spread: number): string {
  const mid = side === 1 ? 0 : 180;
  const a0 = ((mid - spread) * Math.PI) / 180;
  const a1 = ((mid + spread) * Math.PI) / 180;
  return `M${r1(50 + r * Math.cos(a0))} ${r1(50 + r * Math.sin(a0))}A${r1(r)} ${r1(r)} 0 0 1 ${r1(50 + r * Math.cos(a1))} ${r1(50 + r * Math.sin(a1))}`;
}

export function agentFrame(a: AgentLook, t: number, id: string): AgentFrame {
  const ink = a.onLight ? '#0e1116' : '#ffffff';
  const still = a.still ?? false;
  const state = a.state;
  const level = state === 'speaking' && !still ? voiceLevel(t) : 0;
  let sx = 1;
  let sy = 1;
  let rot = 0;
  let dy = 0;
  if (!still) {
    sy = 1 + Math.sin(t * 1.6) * 0.014;
    sx = 1 - Math.sin(t * 1.6) * 0.01;
    if (state === 'speaking') {
      sy += level * 0.045;
      sx -= level * 0.028;
    }
    if (state === 'ringing') {
      const tau = ringing(t);
      if (tau !== null) {
        // A bell's shake: fast, dying away within the ring, with a small lift as it starts.
        rot = 7 * Math.exp(-4.5 * tau) * Math.sin(2 * Math.PI * 13 * tau);
        dy = -2.2 * Math.exp(-6 * tau);
        sy *= 1 + 0.03 * Math.exp(-8 * tau);
      }
    }
    if (state === 'listening') {
      // Head tilted toward the voice, swaying slowly, with a small nod every couple of seconds.
      rot = -7 + Math.sin(t * 0.7) * 1.6;
      const n = t % 2.4;
      const nod = n < 0.5 ? Math.sin((n / 0.5) * Math.PI) : 0;
      dy += nod * 2.4;
      sy *= 1 - nod * 0.025;
    }
    if (state === 'done') {
      const p = t % 2.2;
      dy = p < 0.45 ? -Math.sin((p / 0.45) * Math.PI) * 7 : 0;
    }
    if (a.hover) {
      sy *= 1.035;
      sx *= 1.035;
      dy -= 1.5;
    }
  }
  if (state === 'missed') {
    sy *= 0.94;
    dy += 3;
  }

  const look = { x: (a.look?.x ?? 0) * 5, y: (a.look?.y ?? 0) * 4 };
  let blink = still ? 1 : (t + (a.seed ?? 0)) % 4.3 < 0.12 ? 0.08 : 1;
  // A waiting agent lives a little: one small move every few seconds, never two at once.
  let idleFace: AgentFace | null = null;
  let idleThink = false;
  if (!still && !a.hover && state === 'idle') {
    const { move, p, env, r } = idleMove(t, a.seed ?? 0);
    if (move === 'glance' && !a.look) {
      const angle = r * Math.PI * 2;
      look.x += Math.cos(angle) * 3.6 * env;
      look.y += Math.sin(angle) * 2.6 * env;
    } else if (move === 'blink2') {
      blink = p < 0.1 || (p > 0.22 && p < 0.32) ? 0.08 : 1;
    } else if (move === 'wink') {
      idleFace = 'wink';
    } else if (move === 'curious') {
      idleFace = 'curious';
      rot += (r < 0.5 ? 6 : -6) * env;
    } else if (move === 'hop') {
      idleFace = 'happy';
      if (p < 0.42) dy -= Math.sin((p / 0.42) * Math.PI) * 5;
      else if (p < 0.62) sy *= 1 - 0.045 * Math.sin(((p - 0.42) / 0.2) * Math.PI);
    } else if (move === 'think') {
      idleThink = true;
    } else if (move === 'lookUp' && !a.look) {
      look.y -= 3 * env;
      rot -= 2.5 * env;
    }
  }
  const fill = `url(#${id}-eye)`;

  let face: string;
  if (state === 'thinking' || idleThink) {
    face = [0, 1, 2]
      .map((i) => {
        const wave = still ? 0 : Math.max(0, Math.sin(t * 6 - i * 0.9));
        return `<circle cx="${38 + i * 12}" cy="${r1(49 - wave * 3)}" r="${r1(4.2 * (0.55 + 0.45 * (still ? 1 : wave)))}" fill="${fill}"/>`;
      })
      .join('');
  } else if (state === 'speaking') {
    // Mirrored around the centre bar, tallest in the middle, like a voice meter.
    face = [0, 1, 2, 3, 4]
      .map((i) => {
        const k = Math.abs(i - 2);
        const x = 34 + i * 8 + look.x * 0.5;
        const height = still ? [16, 12, 6][k]! : Math.max(4.5, 5 + voiceLevel(t + k * 0.12) * [22, 16, 9][k]!);
        return `<rect x="${r1(x - 2.6)}" y="${r1(48 - height / 2 + look.y * 0.5)}" width="5.2" height="${r1(height)}" rx="2.6" fill="${fill}"/>`;
      })
      .join('');
  } else if (state === 'done') {
    face = `<path d="M37 49L46 57L64 39" stroke="${fill}" stroke-width="5.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  } else if (state === 'missed') {
    face =
      eyes('sleepy', id, look, 1) +
      (still
        ? `<text x="76" y="26" font-size="12" font-weight="600" font-family="inherit" fill="${ink}">z</text>`
        : [0, 1]
            .map((i) => {
              const p = (t * 0.5 + i * 0.5) % 1;
              return `<text x="${r1(74 + p * 10)}" y="${r1(30 - p * 18)}" font-size="${r1(9 + p * 5)}" font-weight="600" font-family="inherit" fill="${ink}" opacity="${r1(1 - p)}">z</text>`;
            })
            .join(''));
  } else if (state === 'listening') {
    const toward = a.look ? 0 : 2.4;
    face = eyes('attentive', id, { x: look.x + toward, y: look.y + 0.5 }, blink);
  } else if (state === 'ringing') {
    const tau = still ? null : ringing(t);
    const cycle = Math.floor(t / RING_CYCLE);
    const glance = a.look ? 0 : cycle % 2 === 0 ? 2.6 : -2.6;
    face =
      tau !== null
        ? eyes('surprised', id, { x: look.x, y: look.y - 1.5 }, 1)
        : eyes('attentive', id, { x: look.x + glance, y: look.y - 1 }, blink);
  } else {
    face = eyes(a.hover && a.face === 'neutral' ? 'happy' : (a.face === 'neutral' && idleFace) || a.face, id, look, blink);
  }

  let extra = '';
  let ear = 0;
  const speech = state === 'listening' && !still ? voiceLevel(t * 0.9 + 7) : 0;
  if (!still && state === 'listening') {
    // The candidate's voice arriving: three clean arcs ")))" on the right, pulsing inward in
    // turn and brighter while they speak. Thick enough to read at chat-button size.
    const waves = [0, 1, 2]
      .map((k) => {
        const pulse = 0.5 + 0.5 * Math.sin(t * 5 + k * 1.1);
        const o = 0.35 + (0.25 + speech * 0.4) * pulse;
        return `<path d="${sideArc(54 + k * (a.small ? 9 : 7), 1, 22 - k * 2)}" opacity="${r1(Math.min(1, o))}"/>`;
      })
      .join('');
    extra = `<g stroke="${a.onLight ? ink : '#b4ec51'}" stroke-width="${a.small ? 5 : 3.2}" stroke-linecap="round" fill="none">${waves}</g>`;
    ear = a.small ? 0 : 0.15 + speech * 0.7;
  }
  if (!still && state === 'ringing') {
    // Each ring sends two waves out from both sides, easing out as they spread and fade.
    const now = ((t % RING_CYCLE) + RING_CYCLE) % RING_CYCLE;
    const starts = [...RING_STARTS, ...RING_STARTS.map((x) => x - RING_CYCLE)];
    const waves: string[] = [];
    for (const start of starts)
      for (const lag of [0, 0.13]) {
        const p = (now - start - lag) / 0.95;
        if (p < 0 || p >= 1) continue;
        const r = 47 + easeOut(p) * 19;
        const o = (1 - p) ** 1.6 * 0.95;
        const w = 3.2 - p * 1.6;
        for (const side of [1, -1] as const) waves.push(`<path d="${sideArc(r, side, 30)}" stroke-width="${r1(w)}" opacity="${r1(o)}"/>`);
      }
    extra = `<g stroke="${ink}" stroke-linecap="round" fill="none">${waves.join('')}</g>`;
  }
  if (!still && state === 'done') {
    extra = [
      [-6, 18],
      [104, 24],
      [92, 90],
      [4, 84],
    ]
      .map(([x, y], i) => {
        const p = (t * 0.9 + i * 0.25) % 1;
        return `<circle cx="${x}" cy="${r1(y! - p * 6)}" r="${r1(2.4 * (1 - p))}" fill="#b4ec51" opacity="${r1(1 - p)}"/>`;
      })
      .join('');
  }

  const tau = state === 'ringing' && !still ? ringing(t) : null;
  const glow = level * 0.75 + (tau !== null ? Math.exp(-3 * tau) * 0.5 : 0);
  // Ringing shakes from its middle, like a phone buzzing; everything else moves from its base.
  const pivot = state === 'ringing' ? '50 52' : '50 88';
  const faceScale = a.small ? 1.12 : 1;
  if (a.fixed) {
    return { body: '', face: faceScale === 1 ? face : `<g transform="translate(50 48) scale(${faceScale}) translate(-50 -48)">${face}</g>`, extra: '', voice: r1(0.15), ground: 1, ear: 0 };
  }
  return {
    body: `translate(0 ${r1(dy)}) rotate(${r1(rot)} ${pivot}) translate(50 88) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(-50 -88)`,
    face: faceScale === 1 ? face : `<g transform="translate(50 48) scale(${faceScale}) translate(-50 -48)">${face}</g>`,
    extra,
    voice: r1(0.15 + glow),
    ground: r1(1 + Math.min(0, dy) * 0.03),
    ear: r1(ear),
  };
}

/**
 * The whole svg inside: the glass's gradients, the ground shadow or glow, the body with its
 * light, and the frame's moving parts. `id` must be unique on the page (gradient ids).
 */
export function agentMarkup(a: AgentLook, t: number, id = 'agent'): string {
  const c = AGENT_COLOURS[a.colour];
  const f = agentFrame(a, t, id);
  const path = AGENT_SHAPES[a.shape];
  const ground = a.onLight
    ? `<ellipse data-ground cx="50" cy="94" rx="${r1(27 * f.ground)}" ry="4.6" fill="url(#${id}-shadow)"/>`
    : `<ellipse data-ground cx="50" cy="56" rx="${r1(48 * f.ground)}" ry="${r1(46 * f.ground)}" fill="url(#${id}-halo)"/>`;
  return (
    `<defs>` +
    `<radialGradient id="${id}-body" cx="0.38" cy="0.3" r="0.78"><stop offset="0" stop-color="${c.light}"/><stop offset="0.38" stop-color="${c.mid}"/><stop offset="0.8" stop-color="${c.deep}"/><stop offset="1" stop-color="${c.dark}"/></radialGradient>` +
    `<radialGradient id="${id}-edge" cx="0.5" cy="0.46" r="0.56"><stop offset="0.7" stop-color="${c.dark}" stop-opacity="0"/><stop offset="1" stop-color="${c.dark}" stop-opacity="0.55"/></radialGradient>` +
    `<radialGradient id="${id}-foot" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff" stop-opacity="0.6"/><stop offset="0.55" stop-color="#d8f7a8" stop-opacity="0.22"/><stop offset="1" stop-color="#d8f7a8" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${id}-shine" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${id}-voice" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff" stop-opacity="0.85"/><stop offset="0.45" stop-color="${c.glow}" stop-opacity="0.35"/><stop offset="1" stop-color="${c.glow}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id}-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.85"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0.05"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.35"/></linearGradient>` +
    // In user space, so flat shapes (sleepy lines) still get a colour: a bounding-box gradient on a zero-height line draws nothing.
    `<linearGradient id="${id}-eye" gradientUnits="userSpaceOnUse" x1="0" y1="36" x2="0" y2="60"><stop offset="0" stop-color="${c.eyeLift}"/><stop offset="1" stop-color="${c.eye}"/></linearGradient>` +
    `<radialGradient id="${id}-shadow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#0e1116" stop-opacity="0.32"/><stop offset="1" stop-color="#0e1116" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${id}-halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0.55" stop-color="${c.glow}" stop-opacity="${a.small ? 0.2 : 0.32}"/><stop offset="1" stop-color="${c.glow}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${id}-ear" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="0.5" stop-color="#d8f7a8" stop-opacity="0.35"/><stop offset="1" stop-color="#d8f7a8" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="${id}-clip"><path d="${path}"/></clipPath>` +
    `</defs>` +
    ground +
    `<g data-extra>${f.extra}</g>` +
    `<g data-body transform="${f.body}">` +
    `<path d="${path}" fill="url(#${id}-body)"/>` +
    `<g clip-path="url(#${id}-clip)">` +
    `<ellipse data-voice cx="50" cy="50" rx="30" ry="26" fill="url(#${id}-voice)" opacity="${f.voice}"/>` +
    `<ellipse cx="52" cy="80" rx="27" ry="12" fill="url(#${id}-foot)"/>` +
    `<ellipse data-ear cx="88" cy="50" rx="20" ry="32" fill="url(#${id}-ear)" opacity="${f.ear}"/>` +
    (a.small
      ? ''
      : `<path d="M14 40C26 30 74 28 88 38" stroke="#ffffff" stroke-opacity="0.16" stroke-width="7" fill="none" stroke-linecap="round"/>` +
        `<path d="${path}" fill="url(#${id}-edge)"/>`) +
    `<ellipse cx="36" cy="27" rx="17" ry="10" fill="url(#${id}-shine)" opacity="0.75" transform="rotate(-24 36 27)"/>` +
    `<ellipse cx="31" cy="24" rx="4.6" ry="2.8" fill="#ffffff" opacity="0.92" transform="rotate(-24 31 24)"/>` +
    (a.small ? '' : `<ellipse cx="72" cy="73" rx="4" ry="1.8" fill="#ffffff" opacity="0.45" transform="rotate(-40 72 73)"/>`) +
    `</g>` +
    `<path d="${path}" fill="none" stroke="url(#${id}-rim)" stroke-width="1.3"/>` +
    `<g data-face>${f.face}</g>` +
    `</g>`
  );
}
