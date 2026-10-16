# L1 + D2 visual system (founder choice, supersedes all earlier visual directions)

> **2026-10-02:** the website parts (L1) are superseded by `2026-10-02-synergos-website.md`. For the app, `2026-10-02-app-consistency.md` wins where they differ: buttons are 10px soft corners (not pills), status tags 6px, the accent face is Instrument Serif italic, and the agent character replaces the orb.

**Date:** 2026-10-01 · **Founder decision:** website follows Dribbble shot **L1** (Voxai, by Kris Anfalova), app follows **D2** (Voiceon, by Oripio), chosen from `apps/web/.impeccable/dribbble-picks/` (see `picks.json`; open `L1-voxai-kris-anfalova.webp` and `D2-ai-voice-saas-dashboard-voiceon.webp` before building). Stack: Next.js 15 + Tailwind v3 + **shadcn/ui** (Radix) + **GSAP** (ScrollTrigger, timelines) + Motion for small UI transitions.

We follow the shots' **language** closely (composition, proportions, materials, type character, interaction feel), adapted to our product and content. We never copy their logos, illustrations, photos or copy.

**Everything non-visual stays as specified** in `2026-10-01-saas-redesign-design.md` sections 0 (truth rules, naming, pricing, CTA labels), 4 (infrastructure), 5 (website section list and copy, adapted below), 7 (page requirements + audit IDs), 8 (team/invites/roles), 9 (use-case rendering), 10 (accessibility), 11 (verification). Where this file and that one disagree on visuals, this file wins.

---

## 1. The language in one paragraph

Calm, airy, voice-first. Everything sits on a **rounded inset canvas**: a large white panel with generous radius floating on a soft ground (a steel-blue gradient on the website, a light cool grey in the app). Actions are **pills**: a deep ink-navy filled pill for the main action, a white pill with a hairline border for the secondary. Type is a tight, confident **neo-grotesk** with a single **serif italic** accent per page (a person's name in a greeting, or one phrase in a hero card). The voice product shows itself through a **frosted glass transcript card** over a real photograph, ending in a **"Listening…" bar** with a timer. Depth comes from soft hairline borders and very light shadows, never heavy cards.

## 2. Tokens (`app/globals.css` `:root`, exposed in `tailwind.config.js`)

| Token | Value | Use |
|---|---|---|
| `--ground` | `#E9ECF0` | App outer ground (D2) |
| `--ground-site` | `linear-gradient(180deg, #4F7A8E 0%, #A8C4D4 100%)` | Website outer ground behind the hero canvas (L1) |
| `--canvas` | `#FFFFFF` | Inset canvas, cards, inputs |
| `--subtle` | `#F5F7F9` | Quiet fills: table header, hover rows, chips |
| `--muted` | `#EEF1F4` | Selected nav item fill, skeleton |
| `--border` | `#E6E9EE` | Card and divider hairlines (decorative) |
| `--border-input` | `#8A94A6` | Input/checkbox boundaries (3.06:1, WCAG 1.4.11) |
| `--text` | `#0E1116` | Primary text |
| `--text-2` | `#475162` | Secondary text |
| `--text-3` | `#626B78` | Tertiary text, placeholders (verified: 5.39 on white, 5.02 on `--subtle`, 4.76 on `--muted`, 4.55 on `--ground`) |
| `--primary` | `#0F1A2E` | Ink-navy filled pill (main action), active indicators |
| `--primary-hover` | `#1B2A45` | |
| `--accent` | `#3E6A7F` | Steel blue: links, secondary highlights, focus ring, L1's demo pill (verify ≥ 4.5:1 with white) |
| `--accent-soft` | `#E8F0F4` | Tinted chips/panels |
| `--sky-from` / `--sky-to` | `#1E56C8` / `#2E73E0` | D2-style hero gradient card (white text must pass: bold ≥ 24px uses the 3:1 large-text rule; body text sits on the darker end) |
| `--glass` | `rgb(255 255 255 / 0.18)` + `backdrop-filter: blur(18px) saturate(140%)` + `1px rgb(255 255 255 / 0.45)` border + inner highlight | Frosted transcript card and nav pills over photos; solid fallback `rgb(30 52 66 / 0.72)` under `prefers-reduced-transparency` and where `backdrop-filter` is unsupported |
| Status (pill badges) | neutral `#344054/#F2F4F7`, info `#175CD3/#EFF8FF`, success `#067647/#ECFDF3`, warning `#B54708/#FFFAEB`, danger `#B42318/#FEF3F2` | Text/background, each with a 1px border tint and an icon + word (never colour alone); map states exactly as `2026-10-01-saas-redesign-design.md` §2 |

Radii: website hero canvas **28px**, app main canvas **24px**, cards **20px**, inner cards/tiles **16px**, inputs **12px** (search field full pill), buttons and badges **full pill**. Shadows: `--shadow-xs: 0 1px 2px rgb(14 17 22 / .04)`; `--shadow-card: 0 1px 2px rgb(14 17 22 / .04), 0 8px 24px -12px rgb(14 17 22 / .08)`; `--shadow-float: 0 24px 48px -16px rgb(14 17 22 / .18)` (menus, dialogs, the hero canvas). No heavy drop shadows.

Type: **Geist** (next/font/google, variable `wght`) for display and UI; **Source Serif 4** italic (next/font/google, axes `opsz`) for the single accent per page. Display: weight 600, tracking `-0.035em` to `-0.045em`, line-height 1.02–1.08. Website H1 `clamp(2.6rem, 1.5rem + 3.6vw, 4.5rem)`; app page title 28px/600; section title 20px/600; app body 14px; website body 16–17px; meta 12–13px; tabular numbers for times, counts, durations. Sentence case; no all-caps labels except the tiny mono-style overline is NOT used (L1's "TRUSTED BY" row is dropped). No em or en dashes in UI copy.

Icons: Lucide (installed), `strokeWidth={1.5}`, 18–20px in nav and buttons, inside 36–40px circular icon buttons on the app header (D2).

Motion (GSAP for choreography, Motion/CSS for UI state; everything static under `prefers-reduced-motion`):
- Website hero: the frosted transcript card plays a labelled sample call: bubbles appear one by one (fade + 8px rise, 220ms, 0.9s apart, `power3.out`), the Listening bar's level bars animate while "speaking" (stopping 5s after each change, WCAG 2.2.2), the timer ticks in tabular figures, then the card holds the last frame and loops after a rest; a small "Pause sample" pill controls it; pauses off-screen.
- Website sections: one restrained reveal per section (fade + 16px rise, 500ms, stagger 60ms), via ScrollTrigger `once: true`; the how-it-works steps scrub a thin progress line; nothing blocks reading at rest.
- App: Motion/CSS only for sheet/dialog presence (200–300ms), tab underline slide, toast enter; list rows never animate on keyboard actions; no orbs pulsing forever.

## 3. Website (L1 language), mapped onto the section list in `2026-10-01-saas-redesign-design.md` §5

- **Ground:** the page body sits on `--ground-site` behind the hero; below the hero the page continues on a light canvas (`--canvas` / `--subtle` bands) so long reading stays calm. One theme (light).
- **Hero (L1 composition):** a 28px-radius inset canvas, `--shadow-float`, filling the first viewport minus a small outer margin (24px desktop, 12px mobile), split 50/50 on desktop:
  - **Left panel (white):** top row with the logo (LogoMark + "Voice platform") and, top-right, a small status pill "HRVoice is live for hiring teams" (replaces L1's "#1 on ProductHunt", which we can't claim). Centred stack: a soft glossy orb mark (our LogoMark rendered as a 72px orb, CSS gradients, no image), the H1 "Voice agents that make your business calls and show their work." (2–3 lines, centred, tight tracking), the sub "Give it a job. It phones every candidate, asks your questions, and returns the transcript for you to decide.", then two pills: **Start a pilot** (filled ink-navy, with a small circular arrow-dot glyph inside, L1 style) and **Hear a sample call** (white, hairline border; scrolls to `#sample-call`). No logo row (no customers).
  - **Right panel (photo):** a real licensed photograph (calm, soft natural light; see photo credits in `public/images/photos/CREDITS.md`) with `object-fit: cover`. Overlaid: frosted **nav pills** top-left (Use cases, How it works, Pricing, FAQ) and a white **Sign in** pill top-right; a centred frosted **transcript card** (header: agent avatar orb, "Hiring agent", "Sample call" badge; bubbles from `components/marketing/sample-data.ts` SAMPLE_CALL; bottom "Listening…" bar with level bars and an `m:ss` timer); a bottom caption in white: "Every answer, captured as it's said" + one quiet line "Sample call. Illustrative, not a real candidate."
  - **Mobile:** canvas stacks: left panel content first (logo, pill, orb, H1, sub, CTAs), then the photo panel (aspect 4:5) with the transcript card; the nav becomes a menu button opening a Sheet; Sign in moves into the Sheet.
- **Below the hero** (same order and copy as SaaS spec §5, re-skinned): Features as a **bento** of 3–4 rounded cards (20px) with real component previews (call list with status pills, question checklist, answers with timestamp pills) on `--subtle` insets; Sample call deep-dive (transcript + answers card, player controls as pills); How it works as 4 steps with a scrubbing progress line + the six-node "Under the hood" flow drawn with SVG + GSAP; Use cases as 4 module cards with photos (HRVoice live, others "On the roadmap"), D2's "Handpicked" card style; Control with a roles/permissions card preview; Pricing as one pilot card; FAQ (two-column, native details); closing CTA as a rounded `--primary` (ink-navy) band with white text and pills; footer quiet.

## 4. App (D2 language)

- **Ground and canvas:** body on `--ground`; the **sidebar sits directly on the ground** (no panel), and the main content is a white **inset canvas** (24px radius, 12px margin from the viewport edges on desktop, `--shadow-card`), scrolling inside.
- **Sidebar (248px):** brand row (LogoMark + "Voice platform" + collapse icon button); **workspace switcher pill** (white, hairline border, org initials avatar + org name + chevrons; opens a menu of workspaces; real org names only); nav items as 40px rows with icon + label, the active item a **white pill** with `--shadow-xs` and `--text` (others `--text-2`, hover `--muted`); groups: main (Home, Jobs, Candidates, Calls) and "Workspace" (Agents, Knowledge, Analytics, Settings) with a small group label in `--text-3` sentence case; bottom: an **"Invite your team" card** (white, 16px radius, sparkle icon tile, one line of copy, a secondary pill "Invite people" → Settings › Team invite dialog), then the user menu row (avatar initials circle, name, email, chevron → Your account, Switch workspace, Sign out). Collapsed state: 72px icon rail with tooltips.
- **Header (inside the canvas, 64px):** page title (or breadcrumb) left; a **search pill** ("Search jobs and candidates", ⌘K hint) and round icon buttons (only for real features: help/shortcuts, settings) and the avatar on the right. No bell unless a real notifications feature exists.
- **Page header pattern:** greeting or title (28px/600) with the page's single serif-italic accent where it fits (Home: "Good evening, *Priya*" using the user's real first name; other pages use plain sans titles), a one-line description in `--text-2`, and the main action as an ink-navy pill with a leading icon (e.g. "+ Create job").
- **Home (D2 composition):** a sky-gradient **hero card** (left, 24px radius) stating the most important real queue ("6 calls ready for review" + a pill "Review now"), beside a white card with the next queue ("Calls that didn't connect" with retry pills); below, a 3-column grid of stat/queue cards and the "Not called yet" list; first-run uses a getting-started card instead (from SaaS spec §7.1).
- **Lists and tables:** white cards (20px radius, hairline border) containing tables with a `--subtle` header row (12px/500 `--text-3`), 56px rows, hover `--subtle`, selected `--accent-soft`, avatar circles with initials, pill badges, row actions as small ghost icon buttons; boards (kanban) as columns on `--subtle` with white 16px cards.
- **Sheets, dialogs, forms:** sheet = right panel on the canvas with 24px radius on the open edge, `--shadow-float`; dialog 24px radius; inputs 12px radius 44px tall, label above, hint below; tabs as a pill segmented control (D2 style) for 2–4 options or underline tabs for page sections.
- **Voice/agent cards (Agents page):** D2's voice tiles: a soft gradient orb avatar (CSS, deterministic colours from the agent id), name, purpose line, language with flag-free text label (no flag emojis), status pill.
- **Auth pages:** the L1 split canvas: form on the white left panel (max 400px), the photo panel with a frosted card on the right (static, no loop).

## 5. Photography

Real, licensed photographs only (Unsplash License / Pexels License), credited in `apps/web/public/images/photos/CREDITS.md` with a JSON sidecar per file. Calm, natural light, soft focus, warm-cool balance close to L1's blue-grey; people of India where people appear; no logos or readable text. Needed: 1 hero photo (portrait-friendly crop for the right panel), 4 module/use-case photos (hiring, support, sales, appointments), 1 auth panel photo (can reuse the hero). Served via `next/image` with explicit sizes, WebP, `priority` on the hero.

## 6. shadcn/ui

Use shadcn/ui components (Radix + cva) as the base for every primitive. Existing `components/ui/*` already follow shadcn conventions; restyle them to this system and keep their exported names/props (compat aliases stay). Add missing shadcn components where a page needs them (Sidebar, DropdownMenu, Avatar, Table, ToggleGroup, Progress, ScrollArea, Separator, Popover, Switch, Accordion) with the shadcn CLI only if it supports this Tailwind v3 project cleanly (otherwise hand-write them in shadcn style); never ship shadcn's default look: every component takes these tokens.

## 7. Acceptance (visual)

- Side-by-side with the L1 and D2 shots at 1440px: same composition family, proportions, radii, pill language, type character and calm; a designer would say "the same design language", not "a copy".
- Every pre-flight item in the `design-taste-frontend` skill §14 passes for the website (zero em dashes, one accent, one radius rule as documented here, hero fits 1366×768, one label per CTA intent, motion motivated, reduced motion, real images).
- WCAG 2.2 AA: contrast of every token pairing verified by script, keyboard paths, focus visible on white, on ground and on glass.
