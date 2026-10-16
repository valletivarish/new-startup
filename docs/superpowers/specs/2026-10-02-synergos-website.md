# Website style: Synergos (Oripio), learned not copied

Founder decision, 2026-10-02. The website takes its styling from Dribbble L12, "Synergos AI" by Oripio (dribbble.com/shots/27216038). The app keeps D2, "Voiceon", also by Oripio. The founder: "don't exactly copy, but same stylings, train from that." Our layout, copy and photographs are our own. Supersedes the website parts of `2026-10-01-l1-d2-visual-system.md`.

## What we took from the shot
- Full-bleed sky photograph in the hero, fading at its foot into near-black (#050505) sections.
- Glass over photographs: a dark-tinted frost for nav, tags and secondary buttons; a darker "smoke" for panels carrying white text.
- Light, tight sans headlines (Geist 400, -0.045em) with one condensed serif-italic phrase per heading (Instrument Serif italic, shared with the app's D2 greeting).
- Small outlined tags with a ring icon (lime on black, frost on sky), used on a few sections, not all.
- Soft-cornered buttons (10px): black, white and frost. Cards 26px, inner panels 18px.
- Lime (#b4ec51) only for tags, ticks and live states.
- Photo cards with a product panel set on them; colour-wash cards for modules that are not live.

## What we changed from the shot
- Contrast: the shot's white-on-pale-sky text and light glass sit near 2:1 to 3:1. We add a top scrim and a soft-light blue grade to the hero, and tint the frost dark, so all text is 4.5:1 or more (measured 5.0 to 8.6).
- No fake proof: no logo row, stats or testimonials until real ones exist. The quote-card grid became the use-case grid; "Coming later" is labelled.
- The hero's focal point is a candidate on a call with the live call card beside her, not a raised hand.
- Pricing uses the app's own sky-blue card, so website and product share a surface.

## Files
- Tokens and classes: `.site` block in `app/globals.css`; Tailwind names `site-*` in `tailwind.config.js`.
- Sections: `components/site/` (nav, hero, live-call, product, sample-call, how-it-works, use-cases, pricing, faq, closing, footer, kit, motion).
- Photographs: `public/images/site/` with JSON sidecars (alt, use, provenance) and `CREDITS.md`. All generated with Higgsfield (Soul Cinematic), fictional people.

## Motion
- Hero: the photo settles from 1.07 scale and the words rise in order (CSS, so the first paint is never blank).
- Scroll (GSAP ScrollTrigger, `components/site/motion.tsx`): the hero photo drifts and its words fade as they leave; `[data-reveal]` blocks rise 28px once; photographs drift inside their frames. Blocks on screen at load are left alone. Reduced motion: none of it.

## Verified 2026-10-02
- No sideways scroll from 320px to 1920px.
- axe (WCAG 2.2 AA plus best practice): 0 failures on desktop and phone.
- Keyboard: Tab 1 reaches the skip link, then brand, nav or menu, then the hero buttons.
- `pnpm typecheck` clean; `pnpm test` 292 of 292.
