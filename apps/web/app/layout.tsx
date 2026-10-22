import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Geist, Instrument_Serif } from 'next/font/google';
import { AppProviders } from '../components/layout/AppProviders';
import { BRAND } from '../lib/brand';
import './globals.css';

// Display and UI face, variable weight.
const geist = Geist({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-geist',
  display: 'swap',
});

// The condensed serif italic both Oripio references share (Synergos for the website, Voiceon
// for the app): one phrase per heading (.serif-accent, .site-italic). Preloaded: the website
// hero headline uses it above the fold.
const accentSerif = Instrument_Serif({
  subsets: ['latin', 'latin-ext'],
  weight: '400',
  style: ['italic'],
  variable: '--font-accent',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} | AI phone screening for hiring teams`,
    template: `%s | ${BRAND.name}`,
  },
  description:
    'Add a job and your must-ask questions. HRVoice phones each candidate and sends you the recording, transcript and answers. You decide who moves forward.',
};

// Direction contract for design review. Ships in the HTML as a comment, never rendered.
const DIRECTION_CONTRACT =
  '<!-- THESIS: Calm, cinematic voice-agent SaaS styled after two Oripio Dribbble shots: Synergos (L12) for the website, Voiceon (D2) for the app. Sky photography fading into near-black, glass over photos, light tight sans with one serif-italic phrase per heading. STORY: the AI hiring agent, a pearl-glass character, rises out of tall grass on its live call card and acts out a screening call; the visitor sees what comes back, plays a sample call, learns the setup, starts a pilot. FIRST VIEWPORT: full-bleed sky over grass, centred tag, two-line headline, two buttons, the next step, and the agent seated on its live call card. FORM: founder-picked style, not a copy. FINISH: every shipping raster carries its provenance (public/images/site/CREDITS.md). -->';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Browser extensions (screen recorders, password managers) add classes and attributes to
    // <html> and <body> before React loads. Ignore those two elements' own attributes only;
    // everything inside them is still checked.
    <html lang="en" className={`${geist.variable} ${accentSerif.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <div aria-hidden hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
