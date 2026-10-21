import type { Metadata } from 'next';
import { SiteChat } from '../components/site/chat';
import { ClosingSection } from '../components/site/closing';
import { FaqSection } from '../components/site/faq';
import { SiteFooter } from '../components/site/footer';
import { SiteHero } from '../components/site/hero';
import { HowItWorksSection } from '../components/site/how-it-works';
import { SECTIONS, WORDMARK } from '../components/site/kit';
import { SiteMotion } from '../components/site/motion';
import { LiquidNav } from '../components/site/nav-liquid';
import { PricingSection } from '../components/site/pricing';
import { ProductSection } from '../components/site/product';
import { SampleCallSection } from '../components/site/sample-call';

const TITLE = `${WORDMARK} | An AI voice agent that phone-screens your candidates`;
// The hero's line under the headline.
const DESCRIPTION =
  'Add a job and your must-ask questions. HRVoice, an AI voice agent, phones each candidate and sends you the recording, transcript and answers.';

export const metadata: Metadata = {
  // The origin robots.ts and sitemap.ts use, so the canonical and the card image point at the real site.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  // No images here: app/opengraph-image.tsx supplies the card, and Twitter reuses it.
  openGraph: { type: 'website', url: '/', siteName: WORDMARK, title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

/*
  The website, styled after Oripio's Synergos. Seven bands: the sky hero, the playable sample
  call, what comes back, how it works (the one telling of the pilot), pricing, the FAQ, and the
  dusk band that closes the page and carries the footer. Server-rendered; the live call card,
  the sample-call player, the pricing slider, the menu and the scroll motion hydrate in place.
*/
export default function HomePage() {
  return (
    <div className="site relative">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[60] inline-flex h-11 -translate-y-[200%] items-center rounded-[10px] bg-white px-4 text-[0.875rem] font-medium text-site-black focus:translate-y-0"
      >
        Skip to content
      </a>
      <LiquidNav sections={SECTIONS} />
      <main id="main-content">
        <SiteHero />
        <SampleCallSection />
        <ProductSection />
        <HowItWorksSection />
        <PricingSection />
        <FaqSection />
        <ClosingSection />
      </main>
      <SiteFooter />
      <SiteChat />
      <SiteMotion />
    </div>
  );
}
