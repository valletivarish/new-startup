import { ImageResponse } from 'next/og';
import { BRAND } from '../lib/brand';
import { WORDMARK } from '../components/site/kit';

export const alt = 'Voice agents that make your business calls and show their work.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// The image renderer can't read CSS custom properties, so the Strip Board tokens from
// app/globals.css are spelled out here.
const BOARD = '#EEF0EC';
const PAPER = '#FDFDFB';
const INK = '#15191C';
const INK_2 = '#3B4349';
const SIGNAL = '#F2C230';

// Only a regular face ships with the renderer and Archivo isn't loaded, so a thin stroke in the
// text colour gives the bold weight.
const bold = (px: number) => ({ WebkitTextStroke: `${px}px ${INK}` });

/** Placeholder social card until the founder supplies one: a paper strip in a yellow holder on the board. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: BOARD,
          color: INK,
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <svg width="56" height="36" viewBox="2 7 28 18">
            <rect x="2.75" y="7.75" width="26.5" height="16.5" rx="3" fill={PAPER} />
            <path d="M10.75 7.75H5.75a3 3 0 0 0-3 3v10.5a3 3 0 0 0 3 3h5z" fill={SIGNAL} />
            <path d="M10.75 7.75v16.5" stroke={INK} strokeWidth="1.5" />
            <rect x="2.75" y="7.75" width="26.5" height="16.5" rx="3" fill="none" stroke={INK} strokeWidth="1.5" />
            <rect x="14" y="12" width="12" height="2" fill={INK} />
            <rect x="14" y="18" width="8" height="2" fill={INK} />
          </svg>
          <div style={{ fontSize: 36, ...bold(1) }}>{WORDMARK}</div>
        </div>
        <div
          style={{
            display: 'flex',
            background: PAPER,
            border: `3px solid ${INK}`,
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <div style={{ width: 48, background: SIGNAL, borderRight: `3px solid ${INK}` }} />
          <div
            style={{
              display: 'flex',
              flex: 1,
              padding: '44px 52px',
              fontSize: 66,
              lineHeight: 1.08,
              letterSpacing: -1,
              textWrap: 'balance',
              ...bold(2),
            }}
          >
            Voice agents that make your business calls and show their work.
          </div>
        </div>
        <div style={{ fontSize: 28, color: INK_2 }}>{BRAND.tagline}</div>
      </div>
    ),
    size,
  );
}
