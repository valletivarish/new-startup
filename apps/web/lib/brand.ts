/**
 * Legacy brand object — maps to CSS design tokens in globals.css.
 * Prefer CSS variables / Tailwind in new UI. Kept for pages still on inline styles.
 */

export const brand = {
  name: 'Hiring desk',
  colors: {
    ink: '#0c1222',
    inkMuted: '#5c6578',
    paper: '#ffffff',
    paperWash: '#f4f6f9',
    line: '#e4e8ef',
    primary: '#3b5bdb',
    primaryHover: '#314fc4',
    primarySoft: '#eef2ff',
    navy: '#0c1222',
    navySoft: '#1a2236',
    success: '#0f7a4e',
    danger: '#c0392b',
  },
  fonts: {
    sans: 'var(--font-body), system-ui, sans-serif',
  },
  radii: {
    control: 10,
    panel: 16,
  },
} as const;
