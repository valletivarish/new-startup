# Hiring Production Launch — Implementation Plan

> **For agentic workers:** Use subagent-driven-development or execute sequentially. Goal: production-ready hiring product (not MVP).

**Goal:** Recruiter can land → signup → company → hiring agent with real docs → demo → jobs/candidates → phone screen → review results, on a mock-faithful UI.

**Spec:** `docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md`

**Architecture:** Extend existing Nest/Next/Drizzle spine. No rewrite. Isolates parsers + telephony adapters. **Future-safe:** packs registry, generic Contact/Job/Call/Result nouns, domain events at call/result edges for later webhooks/MCP — see spec §6b. Do not build webhooks/MCP now.

---

## File map (primary)

| Area | Files |
|------|--------|
| Design tokens / layout | `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/lib/brand.ts` |
| Landing | `apps/web/app/page.tsx` (marketing), `apps/web/app/login/page.tsx` |
| Auth UX | signup + company create, humanize `ApiClientError` messages |
| Desk chrome | `AppShell.tsx`, dashboard org switcher hide if ≤1 |
| API errors | `authz.guard.ts`, `auth-context.ts` — human messages |
| Uploads | `knowledge/formats.ts`, parsers, knowledge UI, candidates resume file |
| Hiring loop | outbound telephony wiring, Calls UI for hiring sessions |
| Harden | tests, security grep, deploy notes |

---

## Phases

### Phase A — Face of product (this sprint starts here)
1. Brand tokens + fonts (mock: deep blue, white, dark sidebar)
2. Marketing landing at `/`
3. `/login` + `/signup` with company name → create org
4. Human API errors; hide org switcher when one org
5. Wire AppShell across agents/knowledge/tools

### Phase B — Real documents
6. PDF/DOCX/PPTX extract + knowledge upload
7. Candidate resume file upload → text + phone extract

### Phase C — Complete hiring loop
8. Demo clearly labeled; outbound call from job/candidate
9. Calls list from real voice/phone sessions
10. Results panel production polish

### Phase D — Production gate
11. Full test suite + e2e happy path
12. Security/UX/deploy audit checklist signed off

---

## Out of plan
Support/sales packs, webhooks, MCP, custom roles UI.
