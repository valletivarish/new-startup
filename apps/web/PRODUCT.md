# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary (app):** recruiters and hiring owners at Indian SMBs who need to phone-screen many applicants for open roles. Early on, the same person is also the workspace admin. They work at a desk on a laptop, and check results on a phone between interviews.
- **Primary (website):** founders, HR heads and operations leads evaluating whether a voice agent can take real business calls for them.
- **Call recipients:** candidates receive an ordinary phone call. They never see the product.

## Product Purpose

A multi-tenant, provider-independent voice-agent platform. Organizations create, configure, deploy and monitor AI agents that run real business phone calls.

One engine serves every use case. A use case is a configuration, not a separate product: what the work item is (a job, a ticket, a lead, an appointment), who gets called, which knowledge the call may use, what to collect, what result to hand back, which actions follow, and the cost/call policy for that use case. The product UI renders setup and results from that configuration, so a new use case does not need a new app.

The first live use case is hiring (HRVoice): the agent phone-screens candidates against a job's own description and questions, then hands the recruiter a transcript, summary and structured answers.

Success: a recruiter goes from job description to reviewed screens without learning anything about models, speech providers or telephony.

## Positioning

A business voice-agent platform where customers configure business capabilities (voice, language, knowledge, calling capacity, integrations), never infrastructure providers.

Not a generic voice API, not a cheaper clone of a competitor, not a wrapper around one model or voice vendor. The mechanism a neighbour cannot copy truthfully: every call is owned by a piece of work (a job today), carries that work's knowledge into the conversation, and leaves evidence (recording, transcript, answers) that a human reviews before deciding anything.

## Operating Context

- India first (phase 1), +91 numbers, English default.
- Recruiter loop: create job, paste or upload the description (PDF, DOCX, PPTX), set must-ask questions, add candidates (one at a time, CSV, or resume PDF/DOCX with phone extracted), try a browser demo screen, call by phone, review, move the candidate forward.
- Outbound calling to arbitrary numbers depends on carrier KYC. Until a line is connected, the product says so plainly and offers the browser screen.
- Calls can detect voicemail and transfer to a human on the team.

## Capabilities and Constraints

- Live today: hiring module (jobs, candidates, browser and phone screens, recordings, transcripts, summaries, must-ask answers, review, team roles, analytics from real data).
- Not built yet: other use cases (support, sales, appointments, reminders), customer webhooks, MCP/embedding, billing. The engine is being generalised so these become configurations; until one is live it appears on the website only as clearly labelled later work.
- Known product gaps found in the audit are in scope to fix, not only visual issues.
- Pricing: usage-based per completed screen, no per-seat fees, pilot by conversation. No published prices.
- Stack: Next.js 15 App Router, Tailwind, shadcn/ui on Radix, Lucide, Motion, GSAP + ScrollTrigger, Lenis (landing only), TanStack Query. Backend moving from NestJS to Java Spring AI behind the same API contract.
- Terminology: Job, Candidate, Screen (a call against a job), Hiring voice (the configured agent), Workspace (organization).
- Open: overall product name; languages beyond English to claim publicly.

## Brand Commitments

- **Visual direction (founder decision 2026-10-02, final):** design references come from **Dribbble only**, both by the studio Oripio. The website takes its **styling** from shot **L12 Synergos** (full-bleed sky photography fading into near-black sections, glass panels over photos, light tight sans headlines with one condensed serif-italic phrase, small outlined tags, lime used sparingly, soft-cornered black and white buttons). The app follows shot **D2 Voiceon**. The founder said: "don't exactly copy, but same stylings": learn the style, never the layout or content. Photography is generated for us (Higgsfield) and labelled in `public/images/site/CREDITS.md`. Spec: `docs/superpowers/specs/2026-10-02-synergos-website.md`. This supersedes Strip Board, conventional SaaS, America.gov and the L1 Voxai hero.
- Overall product name is undecided. Use a neutral placeholder wordmark until it is chosen.
- Modules are named `<Team>Voice`, after the team whose calls they make: **HRVoice** for hiring (live), **CustomerVoice** for support, **SalesVoice** for sales and **ReceptionVoice** for appointments (all later). "BookingVoice" was retired on 2026-10-02 because it named a transaction, not a team. The same names carry into the product.
- Never ship "HireFlow". "Hiring desk" is retired as a brand.
- No vendor names (speech, model or telephony providers) anywhere in the UI or marketing copy.
- Plain language a recruiter uses. No API paths, provider jargon or raw status codes.
- The product never judges a person on its own; it checks HR's stated requirements and shows the evidence. HR decides, or HR chooses to auto-advance on its own criteria.

## Evidence on Hand

- Real product UI (live screens in `docs/design-refs/02` to `14`).
- A verified live phone screen with a 20-turn transcript on the desk (internal evidence, not a customer story).
- Internal unit-economics model (₹11 to ₹50 per completed screen depending on answer rate). Internal only; not for publication.
- No customers, logos, testimonials, case studies, usage metrics or certifications exist. Do not fabricate any of them. Sample calls on the website must be labelled as samples.

## Product Principles

1. Tell outcome, not configuration: "screen candidates for this job" beats "configure agent parameters".
2. Evidence before judgement: summary first, transcript and recording one click away, the human decides.
3. Honest states: never pretend a call, a line or a metric exists. Missing data is shown as missing.
4. Capabilities, not providers: customers choose what the agent does, never which vendor does it.
5. Fail loudly, recover kindly: every failure names what happened and the next step.

## Accessibility & Inclusion

WCAG 2.2 AA across website and app. Full keyboard paths, visible focus, live regions for call and voice states, `prefers-reduced-motion` honoured everywhere, 44px touch targets (recruiters review on phones), status never conveyed by colour alone.
