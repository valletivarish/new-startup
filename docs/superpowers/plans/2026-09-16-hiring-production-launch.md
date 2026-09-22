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

---

## Deploy readiness (Phase D notes)

### Env (API)
- `DATABASE_URL`, `BETTER_AUTH_SECRET` (≥32 chars, not a known placeholder)
- `COOKIE_SECURE=true` in production; `TRUST_PROXY=true` behind a real proxy
- Voice demo: `ELEVENLABS_ENABLED`, `ELEVENLABS_API_KEY`, `ELEVENLABS_WEBHOOK_SECRET` (only when enabling browser voice)
- Live PSTN: `ELEVENLABS_PHONE_NUMBER_ID` (required for Call phone) + `ELEVENLABS_OUTBOUND_PROVIDER=india` for India screens
- Check: `pnpm telephony:check` must print READY before claiming live phone works
- When phone id is unset, UI/API return a clear blocked message — never invent success
- **Do not require Twilio $20 deposit.** Prefer Exotel KYC + paid India DID with **open outbound** (any resume phone). Carrier trial whitelist is not a product path.

### Migrate
```bash
# from repo root / worktree, with .env loaded
pnpm --filter @platform/db migrate
```

### Staging / production bring-up
```bash
# 1) Postgres + API + worker (one image, two entrypoints)
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
docker compose --profile app up -d --build

# 2) Web (build with NODE_ENV=production — a non-production NODE_ENV breaks `next build`)
NODE_ENV=production pnpm --filter @platform/web build
API_URL=http://127.0.0.1:3001 pnpm --filter @platform/web start

# 3) Health
curl -fsS http://127.0.0.1:3001/health
curl -fsS http://127.0.0.1:3000/ | head -c 200

# 4) Live phone only after import
pnpm telephony:check
```

### Health
- API listens on `:3001` (see startup log `platform-api listening`)
- Web on `:3000` proxies `/backend/*` to API

### Rollback
- Prefer forward-fix migrations; if a release fails, redeploy previous image/commit and keep DB at last known-good migration
- Voice sessions are append-oriented; do not DELETE rows from `voice_sessions` in app code

### Production gate checklist
- [x] PDF/DOCX/PPTX knowledge + resume file upload
- [x] Demo labeled as browser-only (not live phone)
- [x] Calls desk lists real voice sessions
- [x] Outbound phone endpoint refuses honestly when telephony not configured
- [x] Live outbound wired through voice adapter when `ELEVENLABS_PHONE_NUMBER_ID` is set
- [x] Route auth markers include Calls/telephony controllers
- [x] Local recruiter API walkthrough (2026-09-16)
- [x] Wizard uploads + agent knowledge attach UI; AppShell on agents/tools; landing uses local hero (no picsum)
- [x] Landing hero is full-bleed + brand-first with motion; compose `web` service target added to Dockerfile
- [x] Voice demo `ConversationProvider` fix
- [x] Local UI walkthrough (register→agent→job→Calls honest phone banner)
- [x] CI workflow (`.github/workflows/ci.yml`) runs `pnpm test:api` + typechecks
- [x] Operator telephony check: `pnpm telephony:check`
- [x] Full API suite green locally: **526/526** (`pnpm test:api`, 2026-09-16 eve) + DOCX/PPTX extract tests green (**7/7** in knowledge-formats)
- [x] DOCX + PPTX text extract covered by automated tests (not PDF-only)
- [x] Staging bring-up procedure documented (compose `--profile app` + Next web)
- [x] API Docker image builds and boots (`platform-api:hiring-staging-smoke` → `GET /health` = `{"status":"ok"}` on :3002, 2026-09-16). Dockerfile compiles workspace packages to `dist/` for plain `node`.
- [x] Web production build green (`NODE_ENV=production pnpm --filter @platform/web build`; `outputFileTracingRoot` for worktree)
- [x] Wizard highlights Hiring as ready-now ahead of Custom
- [x] Compose `migrate` uses compiled `packages/db/dist/scripts/migrate.js` (no tsx in production image) — verified: `migrations applied`
- [x] Web Docker image boots (`platform-web:hiring-staging-smoke` on :3010 → landing 200; Dockerfile CMD uses `apps/web/node_modules/.bin/next`)
- [x] Pack-gate regression: `agentType: support` create returns 422 (`test/agent-packs.test.ts`)
- [x] Live browser voice smoke (2026-09-16): `POST /agents/:id/voice-sessions` returns real `conversationToken` (1039 chars) after publish
- [x] Day-one pack gate: create only `hiring`|`custom` (other packs rejected as not available yet)
- [x] Local recruiter API walkthrough refreshed (2026-09-16 eve): signup→company→hiring agent publish→job→candidate(+91)→assign→knowledge attach; telephony honest `outboundPhone:false`; outbound Call phone returns 409 blocked
- [x] Knowledge UI uses “document set” (not folder jargon); compose web waits for healthy API
- [x] Agent detail: hiring-first (docs + demo); versions/tools/JSON under advanced; plain-language attach copy
- [x] Desk AppShell is mobile-usable (sticky Menu bar under 800px)
- [x] Operator India DID import helper: `pnpm telephony:import` (+ `-- --import` with `EXOTEL_*`)
- [x] Operator-gated live PSTN smoke — Voicebot App ID `1342474`, DID re-import, Call phone to verified `+918919504427` produced EL conversation with AI audio + 20-turn transcript in desk (voicemail path). Open resume dialing still needs Exotel KYC (trial whitelist).
- [x] Local production API image health smoke (`platform-api:hiring-staging-smoke` → `{"status":"ok"}` on :3002 with production COOKIE_SECURE + strong secret)
- [ ] Staging host smoke on a remote VPS (optional; not required for product loop)

### Connect live phone (operator) — India, low cost
**Product rule:** recruiters dial candidate numbers from resumes/jobs — **no manual whitelist of every candidate.** Whitelist exists only on carrier *trial* accounts.

**Critical — Voicebot App ID (not Landing Flow):**  
ElevenLabs outbound dials the candidate, then bridges audio through an Exotel **ExoML Voicebot applet** (WebSocket). Do **not** use the default “Landing Flow” App ID (rings Sales/Support humans). That produces “unattended call from &lt;mobile&gt;” emails and no AI voice.  

Note: Exotel’s **House of AI → AI Voice Agents** (`voicebot.in.exotel.com`) is a different product (their own bot builder; often 0 test minutes). It is **not** the ExoML Voicebot applet ElevenLabs needs. Ask Exotel support to enable the **ExoML Voicebot applet** on the account, create it in App Bazaar / flow editor, then use that numeric App ID as `EXOTEL_APP_ID`.

**Smoke / production:**
1. Complete Exotel KYC + paid DID with open outbound (not a trial whitelist line)
2. Ask Exotel to enable **Voicebot applet**; create Voicebot flow; note App ID
3. Put `EXOTEL_*` in env (see `.env.example`) and run `pnpm telephony:import -- --import`  
   or import manually in the voice console (App ID = Voicebot, not Landing)
4. Paste printed id into `ELEVENLABS_PHONE_NUMBER_ID`; keep `ELEVENLABS_OUTBOUND_PROVIDER=india`
5. `pnpm telephony:check` must print READY
6. Restart API; Call phone to any candidate `+91` from the job

**Exotel KYC (open outbound to any resume phone):**  
In Exotel: **My Account → Company Info** → `https://my.exotel.com/aiagent34/company_details/#/company-info` → **Start Business Verification** → enter **PAN** (NSDL verify) → complete business docs. Until approved, dialing is limited to verified numbers (product still dials resume phones with no whitelist UI — carrier enforces the limit).

**Email Exotel support (copy/paste):**
```
Subject: Enable Voicebot applet for account aiagent34 (ElevenLabs AI outbound)

Hi Exotel team,

Please enable the Voicebot applet on our account (SID: aiagent34, Singapore / api.exotel.com) and provision at least 2 Voicebot channels for concurrent AI calls.

We are connecting our ExoPhone +919513886363 to an AI voice agent for outbound hiring screens. The default Landing Flow App ID rings our Sales group instead of streaming audio to the AI — we need Voicebot so Connect API outbound can bridge media correctly.

Please confirm when Voicebot appears in App Bazaar so we can create the applet and use its App ID.

Thanks,
Varish Valleti
```
