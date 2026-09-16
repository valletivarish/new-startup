# Voice Agent Platform — Product Design

**Date:** 2026-09-16  
**Status:** Draft for review  
**Scope:** Complete multi-vertical AI phone agent product (India). Hiring pack ships first on one spine; other packs reuse the same engine.

---

## 1. Product intent

Customers sign up, create task-specific AI agents in a friendly wizard, demo the conversation, then assign real work (outbound/inbound phone). Results stay human-reviewed. We never recommend hire/reject/approve — we report facts and pack-defined metrics (e.g. fit % to JD).

**Verticals (packs):** Hiring screen → then Support, Sales/outreach, Appointments, Reminders, Custom.

**Hard product rules**
- Real product: real numbers, real calls (Exotel). No email/SMS link as the primary screen path.
- Privacy: org isolation; PII least-privilege; no cross-tenant training/sharing.
- Subscription: agent count, minutes, contacts, seats, pack unlocks — block clearly at limits.
- Human transfer: AI can escalate to HR/support/clinic; never AI-only as the only path.
- Customer UI never names internal vendors/tools (no “ElevenLabs”, “Exotel”, “Gemini” in product copy). Provider names stay in adapter code + operator env only.
- Nothing fake: missing usage/scores → unavailable/null, not zero.

---

## 2. Customer journey

1. Signup / login → org dashboard (existing auth).
2. Create agent (wizard by **agent type pack**).
3. Upload documents; optional must-ask questions; language (English default; other only if allowed).
4. Configure human transfer targets.
5. **Demo** conversation (labeled demo; not a production contact campaign).
6. Assign **jobs/tasks** (lists, inbound line, campaigns).
7. Live calls → results → role-filtered widgets + analytics.

---

## 3. Create-agent wizard (shared + pack-specific)

**Shared steps:** type → name/purpose → language → documents → special questions → transfer → demo → review (subscription agent limit).

**Pack-specific steps only** (dynamic; hide the rest):

| Pack | Extra setup | Result extras |
|------|-------------|---------------|
| Hiring | Job/JD context, resume→phone on tasks | Answers + fit % to JD (no hire advice) |
| Support | FAQ, hours, support transfer rules | Category, resolution, escalated? |
| Sales | Script, offer, consent/DND notes | Interest, callback, objections |
| Appointments | Calendar, services, slots | Booked / cancelled |
| Reminders | Template, schedule | Delivered / failed |
| Custom | Free-form | Generic structured fields |

---

## 4. Roles, permissions, widgets

**Defaults (ship these):** reuse existing system roles — Owner, Administrator, Agent manager, Knowledge manager, Recruiter, Analyst, Viewer — with current permission catalogue (`packages/permissions`).

**Configurable:** Admin/Owner creates org roles by **cloning a default** and toggling known permissions (`roles.manage`). No inventing new permission strings in the UI.

**Dashboard:** widgets declare required permissions; UI shows/hides by permission (cosmetic). API `@RequirePermission` remains the real gate. Never gate on role name strings (ADR-004).

One primary Admin/Owner per org for billing + role management; others get least privilege.

---

## 5. Domain model (logical)

| Concept | Notes |
|---------|--------|
| Organization + subscription | Limits + pack entitlements |
| Membership → Role → Permissions | Existing pattern |
| Agent + AgentVersion | Existing; add `agentType` / pack id on config |
| Documents / knowledge | Org-private; bound to agent or job |
| Contact | Phone + optional profile/resume extract |
| Job / Task run | Work assignment: agent + contacts or inbound mapping |
| Call | One phone session (direction in/out) |
| Result | Transcript, summary, structured answers, pack metrics |
| Transfer target | Human destinations |
| Widget definition | id + permission + default layout |

Opaque `businessContext` on sessions may link Call/Result to Contact/Job until FKs land — prefer real FKs when tables exist.

---

## 6. Call flow

**Outbound:** start task → check subscription/limits → telephony port places call → voice agent port runs pack → optional transfer → persist Call/Result.

**Inbound:** number mapped to agent/task → same pipeline.

**Demo:** browser or isolated test path; no blast to contact lists.

Failures: mark failed; keep partial transcript; transfer fail must not claim human joined.

---

## 7. Architecture principles (SOLID + loose coupling, YAGNI)

### What we enforce

- **S** — One module owns one concern (wizard pack schema ≠ telephony ≠ billing).
- **O** — New vertical = new **pack definition**, not forks of core call pipeline.
- **L** — Packs obey the same Agent/Job/Call/Result contracts.
- **I** — Small ports: `TelephonyPort`, `VoiceRuntimePort`, `BillingMeterPort` — only methods we call.
- **D** — App/services depend on ports; vendor SDKs live only under existing adapter dirs (same boundary style as MVP-01 ElevenLabs).

### Patterns we use (only these)

| Pattern | Where | Why |
|---------|--------|-----|
| Ports & adapters | Telephony, voice runtime, metering | Swap vendor without rewriting product |
| Strategy / pack registry | Agent type → wizard + result schema | Task-specific without giant conditionals |
| RBAC via permission strings | API + widgets | Already in repo |
| Immutable AgentVersion | Published config | Already in repo |

### Patterns we skip until proven need

- Generic workflow engine / BPM
- Event sourcing
- Per-field policy DSL
- Multi-implementation factories “for later”
- Microservices split

**Rule:** one implementation behind a port is fine; don’t add a second adapter until a second vendor is real. Comment `ponytail:` only when deliberately cutting a corner with a named upgrade path.

### Customer-facing opacity

Product language: “voice agent”, “phone call”, “transfer to your team”.  
Internal adapters may use Exotel / ElevenLabs / LLM providers. Never leak those names into dashboard copy, emails, or client payloads.

---

## 8. Privacy & subscription

- RLS + org_id on all tenant tables; sensitive reads audited (existing sensitive permission set).
- Docs, resumes, audio, transcripts org-scoped.
- Caps: agents, minutes, contacts, seats, packs — hard block + upgrade CTA.
- Analytics: usage and pack metrics only; no “who to take” recommendations.

---

## 9. Errors & testing

- Limit hit, bad phone, provider down, transfer fail → explicit states.
- Cross-tenant → 404.
- Missing provider metrics → null/unavailable.

**Tests:** permission + RLS; pack schema; subscription guards; mocked telephony/voice ports; one operator-gated live outbound smoke; widget visibility by permission.

---

## 10. Build order

| Phase | Deliverable |
|-------|-------------|
| P0 | Pack engine + Hiring wizard + docs + Qs + transfer config + demo |
| P1 | Contacts + resume→phone + Job/Task + result review + default widgets |
| P2 | Live **outbound** via telephony port + usage metering |
| P3 | **Inbound** + custom roles (clone defaults) + analytics |
| P4 | Support / Sales / Appointments / Reminders packs |

MVP-01 browser voice remains an internal/demo path; customer “live job” path is phone.

---

## 11. Out of scope (this design)

- Recommending hire/loan/appointment decisions for the customer
- Showing vendor/tool brands in the product
- Building all packs before hiring spine works on a real call
- Unrelated platform refactors

---

## 12. Decisions locked in brainstorming

- Platform + vertical packs; hiring first on spine, then other layers.
- Agent-centric wizard; jobs/tasks assign work later.
- Outbound + inbound phone; no email/SMS as primary invite.
- English default; other languages only if JD/context allows.
- Full result packet with fit % where pack defines it — never hire advice.
- Recruiter may supply questions; else agent uses JD + experience context.
- Resume upload can extract phone numbers.
- Subscription limits + analytics + dynamic permission widgets.
- Human call transfer required.
- Admin creates roles; widgets follow permissions.
- Hide internal tools from customers.
- SOLID + ports; no unnecessary patterns (ponytail).

---

## 13. Visual reference (locked 2026-09-16)

User-provided landing/desk mock (asset ).

**Working product name:** ai voice agent (lowercase).

**Palette:** white surfaces; primary deep blue CTAs; soft pastel use-case tiles; dark navy process band; dark sidebar + light main for app chrome.

**Landing:** hero with real person on phone + floating call UI chips; use-case grid (Hiring, Support, Sales, Appointments, Reminders, Custom); 5-step how-it-works; dashboard preview; India cues (“Built for India”, +91); CTAs Get started / Watch a demo.

**App:** sidebar Dashboard, Agents, Calls, Contacts, Analytics, Settings; metric cards (Total / Completed / In progress / Human transfer); recent calls table with status pills; permission-gated widgets.

**Copy rules:** no vendor/tool brand names; plain language; demo before live; human transfer emphasized.
