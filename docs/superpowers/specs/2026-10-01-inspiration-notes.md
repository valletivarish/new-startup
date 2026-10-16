# Strip Board inspiration notes

1 Oct 2026. Merges the Dribbble survey (53 screenshots) and the UI-library survey; the redesign spec wins conflicts. Screenshots: `apps/web/.impeccable/inspiration/` (1200px covers, so trust ratios). Bracketed names link to sources.

## 1. How to use this doc

- **Borrow discipline, not clothes:** ratios, fixed slots, timings, interaction rules. Never colours, radii, shadows or type.
- **One world owns the page:** everything is a strip, bay, rail, stamp, ticket or sign; drop patterns that only fit their source world.
- **Checks:** one black-on-yellow action per bay; state = tint + edge + glyph + word; motion only for real events; missing data in words.
- **Settled conflicts:** static H1 (LCP); counts stamp, never roll; one engine per element; the Sheet stays modal (no three-pane layout); no toast countdown fuse.

## 2. Per surface

### Website hero
- One server-rendered mid-story frame (three filled bays, two transcript lines, a tick, a fresh stamp) serves first paint, no-JS and reduced motion. [Mid-action hero] `saas-landing-page-product-demo-2.png`
- About 4s loop: one event at a time, ≥400ms apart, ≥1s rest; no Flip; starts after `load` + idle. [Vercel guidelines]
- Pause button plus off-screen pause; the visitor's pause wins. [Staged hero] `saas-landing-page-product-demo-1-frames.png`
- If 1366×768 won't fit, sub and CTAs move beside a 7-column H1. [Mid-action hero]

### Sample call
- One Transcript fed `currentTime` (site: paused GSAP timeline with turn labels; app: `<audio>` `timeupdate`). Current turn: review tint + edge; unspoken turns hidden in reserved space; write-in only during real-time play. [ElevenLabs transcript]
- A ~50px tabular m:ss column doubles as "Play from here"; speaker inline at 600. [OpenPhone] `conversation-transcript-ui-1.png`
- Native range scrubber on a graphite ruler: 15s ticks, yellow playhead, `aria-valuetext="0:42 of 2:10"`. [VOIS] `ai-voice-landing-page-4.png`
- Ticket buttons ("1:24, notice period answer") seek, keep focus and play state, and scroll only the transcript. [Salach] `conversation-transcript-ui-2.png`
- Answers: right-aligned label/value rows; "3 of 5" expands to list the unanswered ones; no score or verdict. [Simply AI] `recruiting-dashboard-1.png`

### Six stations
- Pin ~65vh per station (100vh feels hijacked); directional label snap on desktop (§3). [ScrollTrigger], [Labels snap]
- Stamps fire on station change and lift on scroll-back; only the track's `scaleY` scrubs. [Sticky Scroll Reveal]
- Reserve six stamp slots; refresh after `document.fonts.ready`; inactive stations `--ink-3`, not faded.
- Mobile and reduced motion: the stacked list; the animated strip is `aria-hidden`. [matchMedia], [Deepgram concept] `ai-voice-landing-page-3.png`

### Use cases bay
- Four strips, one sign family: same cells, different words. [Studio Graphics] `airport-wayfinding-signage-2.png`
- Tags share one slot across strips. [Radio console] `air-traffic-control-interface-1.png`
- "Not live yet": hatched edge, no link, hover or yellow. [Boarding pass] `flight-strip-3.png`

### Desk demo
- Reuse the app board's Motion layout (`layoutId`, `layout="position"`); Flip only for static markup, capturing every strip. [Motion layout], [GSAP Flip]
- Bays move together; the stamp lands on arrival; Undo reverses the slide. [Drag video] `kanban-pipeline-board-4-frames.png`
- Instant panel swaps; if the focused strip leaves its bay, focus its neighbour, never `body`. [Linear Peek]
- No drag; if added, buttons stay and strips never tilt. [Drag card] `kanban-pipeline-board-3.png`

### Control grid
- Large tile: the live decision bar under one evidence line, split by the site's only dashed perforation. [Skylark] `flight-strip-1.png`, [VIVID] `flight-strip-2.png` (notch everywhere: don't)
- Small tiles: one sign layout plus a real receipt (ticket, permission row, CopyField). [Studio Graphics], [Linear]
- A reserved slot stops bar states reflowing the grid. [Radio console]

### Pricing
- Narrow fare strip, three cells: How you pay / Per completed call; Seats / No per-seat fees; Start / A pilot on one role. [Boarding pass]
- 13px labels over 24px values, `--line` verticals. [Skylark]
- One yellow element; no tiers or numbers.

### FAQ
- Native `<details>`, no open or close animation. [Emil]
- Two columns from md; DOM order matches reading order.
- Answers that name a state show the real StateTag. [Wheelchair signage] `airport-wayfinding-signage-1.png`

### App shell and nav rail
- The rail recedes: `--rail-muted`, no icon backgrounds, signal only on the current item; "you are here" repeats on breadcrumb, title and selected strip. [Linear] (2025 refresh), [Wheelchair signage]
- Tablet rail: 12px labels under icons, not tooltips only (changes spec §6). [Dialpad] `call-monitoring-live-2.png`
- ⌘K: `shouldFilter={false}`, ~200ms debounce, a loading row, Empty only when idle, `keywords` aliases for old names ("people", "activity"), selection actions first, no animation. [cmdk]
- Mobile toasts clear the BottomNav. [Sonner]

### Home queues
- Queues, not KPI tiles. [Aoscan] `recruiting-dashboard-3.png` (counter-example)
- Bay header: label, detail, count ("Ready for review", "Oldest waiting 3h", 12); the rail label and "Showing 8 of 31" link to the full list. [Vocalyn] `voice-ai-agent-dashboard-1.png`
- Oldest first; "Waiting 3h" escalates to review ink + glyph. [Atlas] `ai-call-center-dashboard-1.png`
- Row actions only where they come next: Call now, Call again. [Ryven] `ai-call-center-dashboard-3.png`

### Jobs strips
- Two-line strips about 60px (17/13px), compact 48px, 8px gaps, `--line` cell dividers. [Jobdrive] `kanban-pipeline-board-1.png`
- Fixed columns; the tag column fits the longest word, so rows never shift. [TRANSIT] `split-flap-2.png`
- Right-aligned tabular numbers with totals ("12 of 40 called"); "No calls yet", never 0. [Neuva] `call-monitoring-live-3.png`
- A fixture page with one strip per state family. [Dispatch kit] `air-traffic-control-interface-3.png`

### Job setup form and save bar
- Save bar only when dirty ("4 unsaved changes"); `scroll-padding-bottom` = its height; a failed Save focuses the first invalid field. [Vercel guidelines]
- Chosen option: 2px ink border + tint; a 4px-edge Notice only for real consequences. [Plumbline] `split-flap-1.png`
- Readiness: label/value rows, glyph + word. [Stand inspector] `air-traffic-control-interface-2.png`

### Candidates board, sheet and decision bar
- Selection: `x`, Shift+click, Shift+↑/↓, in-list ⌘/Ctrl+A, Esc; tri-state header; "N of M selected"; keyed by candidate id; labels like "Select Priya Sharma". [Linear selection], [shadcn Data Table]
- Bulk: optimistic, ≤160ms total stagger, one counted Undo toast; failures roll back and say why. [21st kanban]
- A time-in-bay cell ("2d"). [Odama board] `kanban-pipeline-board-2.png`
- Sheet as Peek: Previous/Next, in-sheet `j`/`k`, instant; push `?c=` on open, replace after. [Linear Peek]
- Decision bar sticky in the sheet's scroller, under the perforation; fixed labels; an inline optional reason for Not moving forward; then "Moved forward", Undo, Next candidate; no auto-advance. [Odama] `applicant-tracking-system-1.png`
- CSV: summary cells (28 ready, 3 need a fix), a problem-rows filter, per-row re-validation, a live "Import 28 candidates". [OneSchema]

### Calls live bay
- LiveCallStrip: name, job, On call bars, a fixed tabular timer, End call (confirms); timers never roll. [Neuva]
- "Updated 5s ago", or the error and Retry when polling fails. [TRANSIT]
- Recent strips: edge, name and job, duration, outcome, time over date, summary line; "Showing 10 of 370". [Call history] `voice-ai-agent-dashboard-3.png`

### Test call
- A LiveCallStrip: real SDK state, tabular timer, transcript writing in; no orb or latency. [VOCO] `ai-voice-landing-page-1.png`
- Connecting shows real steps, never a stuck 90% bar. [React Bits Micro]
- State changes are announced politely; End call never moves. [Neuva]

### Agents form
- Name and "Voice and language" share one ruled row from md; transfer numbers show "3 of 10". [Skylark]
- The button names the outcome: "Publish agent" or "Save changes". [Odama]
- Pause agent confirms inline with its consequence. [Vercel team]

### Knowledge upload
- Validate type and size first; one sentence per error ("Policy.pdf is 14 MB. The limit is 10 MB."). [useFileUpload]
- A real `<input type="file">` behind a button; paste works; drag highlight clears on `dragleave` and `drop`. [21st upload]
- File strips: Waiting, Uploading n% (real progress), Added, Failed + Retry; "Used on 12 calls" only if the backend sends it. [Aidial] `call-monitoring-live-1.png`

### Analytics
- Label/value strips; every number has a denominator or period; no deltas, sparklines or donuts. [Atlas], [Callora] `voice-ai-agent-dashboard-2.png`
- A failure is an ErrorState, never zeros. [Dialpad]
- `Intl.NumberFormat('en-IN')`, tabular, right-aligned. [CountUp]

### Settings, team and roles
- Team bays: Roles (one sentence, member count), Members, Invites ("Invited 2 days ago"); Invite people is the only yellow; no seat upsell. [Roles first] `team-permissions-settings-1.png`
- The sub-nav's current item is the rail location sign (signal text, 3px bar on `--rail-2`); members show Last active; no per-row "View profile". [Zain] `team-permissions-settings-2.png`, [Relay] `team-permissions-settings-3.png`
- Role changes confirm inline with the consequence; the last owner's controls are disabled with the reason. [Vercel team]
- Matrix: real `<table>`, `<tbody>` per area, full checkbox names, tri-state per area, dependency notes, sticky save bar; no toggles. [Role picker]
- Invite: a Can / Can't list under the role; CopyField "Joins as Recruiter"; Copy is announced. [ATS invite] `invite-team-members-4.png`

### Auth and invite pages
- The AuthShell's left bay reuses the hero's static frame, loop off.
- Invite preview as a strip ("Joins as Recruiter", Waiting tag); expired invites say who to ask. [Untitled UI invite] `invite-team-members-1.png`
- Password rules: a live checklist, glyph + word; submit focuses the first invalid field. [Aoscan], [Vercel guidelines]

### Empty, loading and error states
- Empty by cause: first use = ghost strip, sentence, action; filtered = name the filter, "Clear filters"; no access = who to ask. [Geist Empty]
- Skeletons mirror final geometry, appear after 300ms, stay ≥500ms; flat pulse, no shimmer. [Geist Skeleton]
- Retry keeps the error visible with a busy button; unsafe retries get a specific verb ("Connect phone line"); waits over 10s show real steps. [Geist Error], [21st loaders]

## 3. Motion cookbook

Exits take about 0.7× the enter time; first render never animates; keyboard actions are instant; transform and opacity only.

| Motion | Moves | Timing | Rule |
|---|---|---|---|
| Slide | x/y | 420ms `--ease-standard` | Both bays at once; bulk stagger ≤160ms |
| Stamp | scale 1.06→1, opacity | 200ms `--ease-stamp` | On arrival; lift: 140ms `--ease-exit` fade |
| Write-in | opacity, y 6px→0 | 200ms, 60ms stagger | Real-time play only |
| Press | `:active` y 1px | 80ms | No scale |
| Live bars | scaleY 0.35↔1 | 900ms alternate, offsets 0/150/300ms | Live calls only (§5) |
| Sheet, toast | x or y, opacity | in 320ms, out 200ms | Esc instant; Undo 8s |

Curves: `CustomEase.create("standard", "0.2,0,0,1")`, plus `exit` (`0.4,0,1,1`) and `stamp` (`0.34,1.3,0.64,1`).

Hero loop (`STEP` = bay width + gap):

```js
mm.add("(prefers-reduced-motion: no-preference)", () => {
  const land = { scale: 1.06, opacity: 0, duration: 0.2, ease: "stamp" };
  const arrive = { ...land, immediateRender: false };
  const tl = gsap.timeline({ paused: true, repeat: -1, defaults: { ease: "standard" },
    onRepeat: shiftSampleData }); // reset frame must equal end frame
  tl.from(".s-new", { x: -16, opacity: 0, duration: 0.2 }, 0)
    .from(".s-live .line", { y: 6, opacity: 0, duration: 0.2, stagger: 0.5 }, 0.6)
    .from(".s-live .tick", land, 1.3)
    .to(".s-live", { x: STEP, y: DY, duration: 0.42 }, 1.8)
    .set(".s-live", { attr: { "data-state": "review" } }, 2.22)
    .from([".s-live .tag", ".count-review"], arrive, 2.22)
    .to(".s-new", { x: STEP, duration: 0.42 }, 2.4)
    .set(".s-new", { attr: { "data-state": "live" } }, 2.82)
    .from(".s-new .tag", arrive, 2.82)
    .to(".s-oldest", { opacity: 0, duration: 0.14, ease: "exit" }, 4.0);
});
```

Six stations:

```js
mm.add({ desk: "(min-width: 1024px)", calm: "(prefers-reduced-motion: reduce)" }, ({ conditions: c }) => {
  if (!c.desk || c.calm) return;
  gsap.set(".station-stamp", { opacity: 0 });
  let at = -1;
  const tl = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: {
    trigger: "#how-it-works", pin: true, start: "top top", scrub: true,
    end: () => "+=" + innerHeight * 0.65 * 6, anticipatePin: 1, invalidateOnRefresh: true,
    snap: { snapTo: "labelsDirectional", duration: { min: 0.2, max: 0.5 }, delay: 0.1 },
    onUpdate: (st) => { const i = Math.round(st.progress * 5); if (i !== at) { setStation(i, at); at = i; } },
  } });
  for (let i = 0; i <= 5; i++) tl.addLabel("s" + i, i);
  tl.fromTo(".track-fill", { scaleY: 0 }, { scaleY: 1, duration: 5 }, 0);
});
document.fonts.ready.then(() => ScrollTrigger.refresh());
```

**Reduced motion:** CSS sets `--dur-*` to `0.01ms` (0 skips `transitionend`), freezes live bars and sets `scroll-behavior: auto`. The app uses `<MotionConfig transition={{ duration: 0 }}>` under `useReducedMotion()`, since `reducedMotion="user"` keeps fades. Fallbacks are designed end states: static board, stacked stations, full transcript.

## 4. Category defaults to avoid

- **Talk-to-the-bot heroes:** Retell's "Get a call" form, Vapi's "Start call" mic, Bolna's demo number.
- **Voice as orb or waveform:** [VOCO], [Aoscan], [Deepgram concept], ElevenLabs UI.
- **Dark glow and glass:** Vapi, Bland, Bolna, [Neuva], [Convox] `ai-call-center-dashboard-2.png`.
- **Vanity proof:** latency headlines, "1 Billion calls", badge rows, logo marquees.
- **KPI rows with deltas and zeros:** [Vocalyn], [Callora], [Dialpad].
- **Scores on people:** "High fit" ([Simply AI]), "+94%" ([Recruiting ATS] `recruiting-dashboard-2.png`), thumbs-up percentages ([Odama board]), Ribbon's ratings.
- **Card grids, feature tabs, tiered pricing:** Retell, Vapi, [Board site] `saas-landing-page-product-demo-3.png`.
- **Pills, colour-only status, caps labels:** [Ryven], [Flipboard] `split-flap-3.png`.
- **Motion tropes:** count-up, split-flap text, blur-in words ([Linear hero breakdown]), spring tabs ([Aceternity Tabs]), shimmer, Lenis.
- **Leaks:** ISO times, jitter, "Create Event" in an invite ([Invite modal] `invite-team-members-3.png`), seat upsells.

## 5. Gaps

- Dribbble has no real flight-progress strips; our strip anatomy is unprecedented and untested.
- Timings observed in videos are approximate (read from frame sheets).
- The FAQ, auth pages, agent form and analytics had no references; their directives are derived.
- Our picks, not observed: write-in 200ms, press 80ms, the live-bar cycle, the 300/500ms loader thresholds.
- Live bars outlast WCAG 2.2.2's 5s on long calls: stop them after 5s, or add Pause to Live now?
- Unconfirmed backend data: time in bay, "Used on N calls", Last active, the "Waiting" threshold.
- Sample call: audio or text, real-time or compressed?
- Spec departures needing sign-off: tablet rail labels, the hero's 7/5 fallback.
- Linear's 2025 refresh has no primary URL; category sites have no screenshots.

<!-- Link definitions: these render as the bracketed links above. -->
[Radio console]: https://dribbble.com/shots/24293075-Voice-Communication-System-UI-for-Air-Traffic-Control
[Stand inspector]: https://dribbble.com/shots/27111526-Airport-Stand-Management-Interface-ATC-Operations-Dashboard
[Dispatch kit]: https://dribbble.com/shots/27419457-Logistics-Dispatch-UI-Component-Library
[Skylark]: https://dribbble.com/shots/27660180-Skylark-Flight-Booking-App-UI
[VIVID]: https://dribbble.com/shots/26904391-Flight-Booking-Web-App
[Boarding pass]: https://dribbble.com/shots/23846631-Flight-Booking-Mobile-App
[Wheelchair signage]: https://dribbble.com/shots/25136850-Enhancing-Wayfinding-Signage-for-Wheelchair-users
[Studio Graphics]: https://dribbble.com/shots/1519711-Studio-Graphics
[Plumbline]: https://dribbble.com/shots/27598039-Quote-Calculator-Estimate-Booking-UI
[TRANSIT]: https://dribbble.com/shots/27467428-TRANSIT-Real-time-City-Transit
[Flipboard]: https://dribbble.com/shots/2465995-Departures-Airport-Flipboard
[Vocalyn]: https://dribbble.com/shots/27599237-AI-Voice-Agent-Dashboard-UI-UX-Design
[Callora]: https://dribbble.com/shots/27684608-Callora-AI-Voice-Agent-Dashboard-Overview
[Call history]: https://dribbble.com/shots/27591537-AI-Voice-Agent-Call-History-Dashboard-SaaS-Admin-UI-UX
[Atlas]: https://dribbble.com/shots/27651765-Atlas-AI-Live-Queue-Real-Time-Call-Center-Dashboard
[Convox]: https://dribbble.com/shots/26435991-Convox-SaaS-Call-Center-Dashboard
[Ryven]: https://dribbble.com/shots/26842786-Ryven-CRM-Smart-AI-Dialer-Call-Center-Dashboard
[Aidial]: https://dribbble.com/shots/26816426-Aidial-AI-Customer-Support-Sales-Dashboard
[Dialpad]: https://dribbble.com/shots/27362815-Dialpad-Live-Dashboard-UX-Redesign
[Neuva]: https://dribbble.com/shots/27685082-Call-Center-Monitoring-Dashboard-Neuva
[OpenPhone]: https://dribbble.com/shots/22811919-AI-call-summaries-and-transcripts
[Salach]: https://dribbble.com/shots/27651387-Salach-ai-AI-Sales-Conversation-Product
[Simply AI]: https://dribbble.com/shots/27409131-AI-Recruiting-Dashboard-SaaS-Widget-Popup-Simply-AI
[Recruiting ATS]: https://dribbble.com/shots/15273882-Recruiting-Dashboard-ATS
[Aoscan]: https://dribbble.com/shots/27351461-Aoscan-AI-Powered-SaaS-HR-Recruitment-Dashboard
[Odama]: https://dribbble.com/shots/19308494-Dashboard-Applicant-tracking-system
[Jobdrive]: https://dribbble.com/shots/23424811-Deals-Pipeline-CRM-Kanban-Board
[Odama board]: https://dribbble.com/shots/19646749-ATS-Candidate-Pipeline-Board-iPadOS-view
[Drag card]: https://dribbble.com/shots/19574696-Candidate-Card-Hiring-Pipeline-Board
[Drag video]: https://dribbble.com/shots/27494942-CRM-Kanban-Pipeline-for-Sales-Teams-Drag-Drop-Interaction
[Roles first]: https://dribbble.com/shots/27384401-Team-Members-Permissions-UI-SaaS-Settings-Role-Management
[Zain]: https://dribbble.com/shots/26514864-Settings-Page-UI-UX-Design-User-Role-Management
[Relay]: https://dribbble.com/shots/27494089-Team-Permissions-Dashboard-Design-for-SaaS-Relay
[Untitled UI invite]: https://dribbble.com/shots/26482440-Invite-team-members-Untitled-UI
[Invite modal]: https://dribbble.com/shots/20750826-Invite-team-member-Modal
[ATS invite]: https://dribbble.com/shots/18781446-Application-Tracking-System-Invite-team-members
[Staged hero]: https://dribbble.com/shots/27261147-SaaS-Landing-Page-UI-UX-AI-Customer-Support-Automation
[Mid-action hero]: https://dribbble.com/shots/27321356-AI-SaaS-Landing-Page-No-Code-Component-Builder-Web-UI
[Board site]: https://dribbble.com/shots/27650855-Board-Enterprise-Planning-Platform-Website-Design-SaaS
[VOCO]: https://dribbble.com/shots/27574937-VOCO-AI-Voice-Conversation-Landing-Page
[Deepgram concept]: https://dribbble.com/shots/27254237-AI-Voice-Assistant-Landing-Page-UI
[VOIS]: https://dribbble.com/shots/24016247-AI-Voice-Generator-Landing-Page
[Linear]: https://linear.app
[Linear hero breakdown]: https://www.kaushikmurali.com/playground/linear
[Linear selection]: https://linear.app/docs/select-issues
[Linear Peek]: https://linear.app/docs/peek
[matchMedia]: <https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/>
[ScrollTrigger]: https://gsap.com/docs/v3/Plugins/ScrollTrigger/
[GSAP Flip]: https://gsap.com/docs/v3/Plugins/Flip/
[Labels snap]: https://codepen.io/GreenSock/pen/NWEbwqy
[Vercel guidelines]: https://vercel.com/design/guidelines
[Vercel team]: https://vercel.com/docs/rbac/managing-team-members
[Sticky Scroll Reveal]: https://ui.aceternity.com/components/sticky-scroll-reveal
[Aceternity Tabs]: https://ui.aceternity.com/components/tabs
[ElevenLabs transcript]: https://github.com/elevenlabs/ui/blob/main/apps/www/registry/elevenlabs-ui/ui/transcript-viewer.tsx
[shadcn Data Table]: https://ui.shadcn.com/docs/components/data-table
[Motion layout]: https://motion.dev/docs/react-layout-animations
[21st kanban]: https://21st.dev/blog/react-kanban-drag-drop-components
[21st loaders]: https://21st.dev/blog/react-loader-components
[21st upload]: https://21st.dev/blog/react-file-upload-components
[Role picker]: https://21st.dev/@cnippet-dev/components/role-permissions-picker
[useFileUpload]: https://github.com/cosscom/coss/blob/main/apps/origin/registry/default/hooks/use-file-upload.ts
[cmdk]: https://github.com/pacocoursey/cmdk
[Emil]: https://emilkowal.ski/ui/you-dont-need-animations
[Sonner]: https://github.com/emilkowalski/sonner
[OneSchema]: https://www.oneschema.co/blog/building-a-csv-uploader
[Geist Empty]: https://vercel.com/geist/empty-state
[Geist Skeleton]: https://vercel.com/geist/skeleton
[Geist Error]: https://vercel.com/geist/error
[CountUp]: https://github.com/DavidHDev/react-bits/tree/main/src/ts-tailwind/TextAnimations/CountUp
[React Bits Micro]: https://github.com/DavidHDev/react-bits/tree/main/src/ts-tailwind/Micro
