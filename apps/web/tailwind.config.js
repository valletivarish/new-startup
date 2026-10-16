/** @type {import('tailwindcss').Config} */

// L1 + D2. Values live in app/globals.css; this file only names them. Legacy names (Strip
// Board and earlier) stay mapped onto the new palette so pages awaiting rebuild keep compiling.

const status = (family) => ({
  text: `var(--status-${family}-text)`,
  bg: `var(--status-${family}-bg)`,
  border: `var(--status-${family}-border)`,
});

const state = (family) => ({
  tint: `var(--state-${family}-tint)`,
  edge: `var(--state-${family}-edge)`,
  ink: `var(--state-${family}-ink)`,
});

const geist = [
  'var(--font-geist)',
  'ui-sans-serif',
  'system-ui',
  '-apple-system',
  '"Segoe UI"',
  'Roboto',
  'Helvetica',
  'Arial',
  'sans-serif',
];

const accentSerif = ['var(--font-accent)', 'ui-serif', 'Georgia', 'Cambria', '"Times New Roman"', 'serif'];

// App 12 to 28 by role, plus the website display sizes. Headings carry weight 600 and
// tighter tracking; a font-* class still wins.
const heading = (letterSpacing) => ({ letterSpacing, fontWeight: '600' });
const type = {
  caption: ['0.75rem', { lineHeight: '1rem' }], // 12
  meta: ['0.8125rem', { lineHeight: '1.125rem' }], // 13
  label: ['0.875rem', { lineHeight: '1.25rem' }], // 14, controls and labels
  body: ['0.875rem', { lineHeight: '1.25rem' }], // 14, app body
  md: ['1rem', { lineHeight: '1.5rem' }], // 16, website body
  lead: ['1.0625rem', { lineHeight: '1.625rem' }], // 17, website sub, page descriptions
  title: ['1.0625rem', { lineHeight: '1.5rem' }], // 17, card titles
  section: ['1.25rem', { lineHeight: '1.75rem', ...heading('-0.01em') }], // 20
  subpage: ['1.5rem', { lineHeight: '1.875rem', ...heading('-0.02em') }], // 24
  page: ['1.75rem', { lineHeight: '2.125rem', ...heading('-0.025em') }], // 28, app page title
  'display-2': ['clamp(2rem, 1.3rem + 2vw, 2.75rem)', { lineHeight: '1.08', ...heading('-0.035em') }], // website H2
  'display-1': ['clamp(2.6rem, 1.5rem + 3.6vw, 4.5rem)', { lineHeight: '1.04', ...heading('-0.04em') }], // website H1
};

module.exports = {
  // Light only. 'class' keeps any stray dark: variant from following the OS setting.
  darkMode: ['class'],
  // Without it a var() ring colour can't take the default 0.5 opacity and Tailwind falls back to blue.
  future: { respectDefaultRingColorOpacity: true },
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    boxShadow: {
      none: 'none',
      xs: 'var(--shadow-xs)',
      card: 'var(--shadow-card)',
      float: 'var(--shadow-float)',
      // Legacy keys mapped onto the three depths.
      DEFAULT: 'var(--shadow-xs)',
      sm: 'var(--shadow-xs)',
      md: 'var(--shadow-card)',
      lg: 'var(--shadow-float)',
      xl: 'var(--shadow-float)',
      '2xl': 'var(--shadow-float)',
      inner: 'none',
    },
    extend: {
      colors: {
        ground: 'var(--ground)',
        canvas: 'var(--canvas)',
        subtle: 'var(--subtle)',
        muted: { DEFAULT: 'var(--muted)', foreground: 'var(--text-3)' },
        border: { DEFAULT: 'var(--border)', input: 'var(--border-input)' },
        text: { DEFAULT: 'var(--text)', 2: 'var(--text-2)', 3: 'var(--text-3)' },
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          foreground: 'var(--primary-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          soft: 'var(--accent-soft)',
          foreground: 'var(--accent-foreground)',
        },
        sky: { from: 'var(--sky-from)', to: 'var(--sky-to)' },
        chart: {
          series: 'var(--chart-series)',
          'series-active': 'var(--chart-series-active)',
          'stage-1': 'var(--chart-stage-1)',
          'stage-2': 'var(--chart-stage-2)',
          'stage-3': 'var(--chart-stage-3)',
          'stage-4': 'var(--chart-stage-4)',
        },
        status: {
          neutral: status('neutral'),
          info: status('info'),
          success: status('success'),
          warning: status('warning'),
          danger: status('danger'),
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          hover: 'var(--destructive-hover)',
          foreground: 'var(--primary-foreground)',
        },
        scrim: 'var(--scrim)',
        // The website (Synergos styling), defined on .site in globals.css.
        site: {
          black: 'var(--site-black)',
          raised: 'var(--site-raised)',
          line: 'var(--site-line)',
          fg: 'var(--site-fg)',
          'fg-2': 'var(--site-fg-2)',
          'fg-3': 'var(--site-fg-3)',
          lime: 'rgb(var(--site-lime-rgb) / <alpha-value>)',
          sky: 'var(--site-sky)',
        },

        // shadcn alias names. shadcn's background is the surface its components sit on (dialogs,
        // sheets, ring offsets): the canvas here. The page ground is bg-ground.
        background: 'var(--canvas)',
        foreground: 'var(--text)',
        input: 'var(--border-input)',
        ring: 'var(--focus-ring)',
        secondary: { DEFAULT: 'var(--canvas)', foreground: 'var(--text)' },
        card: { DEFAULT: 'var(--canvas)', foreground: 'var(--text)' },
        popover: { DEFAULT: 'var(--canvas)', foreground: 'var(--text)' },
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--status-info-text)',

        // Legacy Strip Board names, through the legacy variables in globals.css.
        board: { DEFAULT: 'var(--board)', deep: 'var(--board-deep)' },
        paper: 'var(--paper)',
        ink: { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', 3: 'var(--ink-3)' },
        line: { DEFAULT: 'var(--line)', strong: 'var(--line-strong)' },
        rail: {
          DEFAULT: 'var(--rail)',
          2: 'var(--rail-2)',
          text: 'var(--rail-text)',
          muted: 'var(--rail-muted)',
        },
        signal: {
          DEFAULT: 'var(--signal)',
          hover: 'var(--signal-hover)',
          press: 'var(--signal-press)',
        },
        'danger-ink': 'var(--danger-ink)',
        'success-ink': 'var(--success-ink)',
        state: {
          queued: state('queued'),
          live: state('live'),
          review: state('review'),
          decided: state('decided'),
          failed: state('failed'),
        },
      },
      backgroundImage: {
        'ground-site': 'var(--ground-site)',
        sky: 'var(--sky)',
      },
      borderColor: { DEFAULT: 'var(--border)' },
      ringColor: { DEFAULT: 'var(--focus-ring)' },
      ringOffsetColor: { DEFAULT: 'var(--canvas)' },
      ringWidth: { DEFAULT: '2px' },
      borderRadius: {
        xs: 'var(--radius-xs)',
        button: 'var(--radius-button)',
        input: 'var(--radius-input)',
        'card-sm': 'var(--radius-card-sm)',
        card: 'var(--radius-card)',
        canvas: 'var(--radius-canvas)',
        hero: 'var(--radius-hero)',
        pill: 'var(--radius-pill)',
        // Legacy keys mapped onto the roles.
        strip: 'var(--radius-strip)',
        control: 'var(--radius-control)',
        sheet: 'var(--radius-sheet)',
        sm: 'var(--radius-xs)',
        DEFAULT: 'var(--radius-xs)',
        md: 'var(--radius-input)',
        lg: 'var(--radius-card-sm)',
        xl: 'var(--radius-card)',
        '2xl': 'var(--radius-canvas)',
        '3xl': 'var(--radius-hero)',
      },
      fontFamily: {
        sans: geist,
        display: geist, // legacy
        'accent-serif': accentSerif,
      },
      fontSize: {
        ...type,
        // Legacy keys mapped onto the scale.
        xs: type.caption,
        sm: type.label,
        base: type.md,
        lg: type.title,
        xl: type.section,
        '2xl': type.subpage,
        '3xl': type.page,
        '4xl': type['display-2'],
      },
      transitionDuration: {
        DEFAULT: 'var(--dur-fast)',
        instant: 'var(--dur-instant)',
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
        slow: 'var(--dur-slow)',
        strip: 'var(--dur-strip)', // legacy
        normal: 'var(--dur-base)', // legacy
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--ease-standard)',
        standard: 'var(--ease-standard)',
        out: 'var(--ease-out)',
        exit: 'var(--ease-exit)',
        stamp: 'var(--ease-stamp)', // legacy
        'in-out': 'var(--ease-standard)', // legacy
      },
      minHeight: {
        touch: '2.75rem',
        control: '2.75rem',
      },
      height: {
        control: '2.75rem',
        'control-sm': '2.25rem',
      },
      // New keyframes move with the individual translate and scale properties, so they
      // compose with a transform the element already has (a centred dialog keeps its centring).
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'sheet-in': { from: { translate: '100% 0' }, to: { translate: '0 0' } },
        'sheet-out': { from: { translate: '0 0' }, to: { translate: '100% 0' } },
        'dialog-in': {
          from: { opacity: '0', scale: '0.98', translate: '0 4px' },
          to: { opacity: '1', scale: '1', translate: '0 0' },
        },
        'dialog-out': { from: { opacity: '1', scale: '1' }, to: { opacity: '0', scale: '0.98' } },
        'toast-in': {
          from: { opacity: '0', translate: '0 8px' },
          to: { opacity: '1', translate: '0 0' },
        },
        // Level bars of the Listening bar. Set transform-origin on the bar.
        'listening-bar': {
          '0%, 100%': { scale: '1 0.35' },
          '50%': { scale: '1 1' },
        },
        // Legacy.
        stamp: {
          from: { opacity: '0', transform: 'scale(1.06)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'live-bar': {
          '0%, 100%': { transform: 'scaleY(0.35)' },
          '50%': { transform: 'scaleY(1)' },
        },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'slide-in-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'slide-out-right': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(100%)' } },
        'slide-out-left': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-100%)' } },
        'slide-out-down': { from: { transform: 'translateY(0)' }, to: { transform: 'translateY(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in var(--dur-base) var(--ease-out)',
        'fade-out': 'fade-out var(--dur-fast) var(--ease-exit)',
        'sheet-in': 'sheet-in var(--dur-slow) var(--ease-out)',
        'sheet-out': 'sheet-out var(--dur-base) var(--ease-exit)',
        'dialog-in': 'dialog-in var(--dur-base) var(--ease-out)',
        'dialog-out': 'dialog-out var(--dur-fast) var(--ease-exit)',
        'toast-in': 'toast-in var(--dur-slow) var(--ease-out)',
        'toast-out': 'fade-out var(--dur-fast) var(--ease-exit)',
        // 5 x 0.9s, then the bars rest (WCAG 2.2.2). Restart it on each new utterance.
        'listening-bar': 'listening-bar 0.9s var(--ease-standard) 5',
        // Legacy.
        stamp: 'stamp var(--dur-base) var(--ease-stamp)',
        'live-bar': 'live-bar 0.9s var(--ease-standard) infinite', // busy glyphs only
        'live-bar-brief': 'live-bar 0.9s var(--ease-standard) 5',
        'slide-in-right': 'slide-in-right var(--dur-slow) var(--ease-out)',
        'slide-in-left': 'slide-in-left var(--dur-slow) var(--ease-out)',
        'slide-in-up': 'slide-in-up var(--dur-slow) var(--ease-out)',
        'slide-out-right': 'slide-out-right var(--dur-base) var(--ease-exit)',
        'slide-out-left': 'slide-out-left var(--dur-base) var(--ease-exit)',
        'slide-out-down': 'slide-out-down var(--dur-base) var(--ease-exit)',
      },
    },
  },
  plugins: [],
};
