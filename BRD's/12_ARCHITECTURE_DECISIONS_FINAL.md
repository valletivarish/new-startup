# Final Architecture Decisions

**Status:** APPROVED — consolidated from ADR-001 … ADR-007
**Date:** 2026-08-16
**Approved by:** Founder, 2026-08-16
**Supersedes:** all prior architectural ambiguity in `03_SYSTEM_ARCHITECTURE.md`, `04_DATABASE_API_SPEC.md`, and `06_PROVIDER_AND_COST_SPEC.md`

This is the single authoritative architecture document. Where it conflicts with an older specification file, this document wins, and the older file has been corrected — see `13_SPEC_CHANGES_REQUIRED.md` for the applied changelog.

---

## Decision record

| ADR | Decision | Status |
|---|---|---|
| [ADR-001](10_ADRs/ADR-001-technology-stack.md) | Technology stack | ACCEPTED |
| [ADR-002](10_ADRs/ADR-002-authentication.md) | Authentication | ACCEPTED — with clarification on the auth/authz boundary |
| [ADR-003](10_ADRs/ADR-003-tenant-isolation.md) | Tenant isolation | ACCEPTED — strong approval |
| [ADR-004](10_ADRs/ADR-004-permission-model.md) | Permission model | ACCEPTED |
| [ADR-005](10_ADRs/ADR-005-user-organization-membership.md) | Membership model | ACCEPTED — strong approval |
| [ADR-006](10_ADRs/ADR-006-hosting-deployment.md) | Hosting and deployment | ACCEPTED WITH CONDITION — vendor selection pending benchmarks |
| [ADR-007](10_ADRs/ADR-007-agent-runtime-shape-and-voicepipeline-interface.md) | Runtime shape, VoicePipeline interface | ACCEPTED — founder amendment |

---

# A. APPROVED ARCHITECTURE

## A1. The architectural thesis

We are not building a wrapper around a telephony provider and a language model. We are building the **orchestration and business layer** that can use those providers interchangeably. Every external capability sits behind an interface, and replacing any provider must change only an adapter.

This is the distinction the entire architecture exists to protect.

## A2. System shape

```text
                    ┌─────────────────────┐
                    │   Organization      │
                    │                     │
                    │ Users + Memberships │
                    │ Roles + Permissions │
                    │ Agents              │
                    │ Knowledge           │
                    │ Workflows           │
                    │ Candidates          │
                    │ Usage + Billing     │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   Platform API      │
                    │  NestJS / Fastify   │
                    │                     │
                    │  AuthN → AuthZ →    │
                    │  Tenant context     │
                    └──────────┬──────────┘
                               │
                 ┌─────────────┼─────────────┐
                 ▼             ▼             ▼
             Agent        Knowledge       Workflow
             Runtime        / RAG          Engine
                 │             │             │
                 └─────────────┼─────────────┘
                               │
                               ▼
                      Intelligence Layer
                               │
                  ┌────────────┼────────────┐
                  ▼            ▼            ▼
              LLMProvider   STTProvider  TTSProvider
                  │
                  ▼
              Tool / Action Layer
                  │   (authorized through the permission layer)
        ┌─────────┼──────────┐
        ▼         ▼          ▼
      ATS      Calendar     CRM
```

Voice path, from Phase 5:

```text
Candidate
   ↕
TelephonyProvider (adapter)
   ↕
Voice Gateway            ← second entrypoint, same codebase
   ↕
VoicePipeline interface  ← DEFINED IN PHASE 1
   ↕
Agent Runtime (AgentSession)
   ↕
RAG + Memory + Rules + LLM + Tools
   ↕
VoicePipeline interface
   ↕
Voice Gateway
   ↕
TelephonyProvider (adapter)
```

**Every box is replaceable.** That is the requirement, not an aspiration.

## A3. Approved technology inventory

Nothing outside this list may be introduced without a new ADR.

| Layer | Technology | Justification |
|---|---|---|
| Language | TypeScript, `strict: true` | ADR-001 — one language for a small team |
| Frontend | Next.js (App Router) | ADR-001 |
| UI | Tailwind CSS + shadcn/ui + Radix | Accessibility requirements, `05_UX` §19 |
| Data fetching | TanStack Query | Cache invalidation on org switch |
| Backend | NestJS on Fastify | Modules map to architecture §2; DI hosts provider adapters |
| Validation | Zod | Boundary validation; structured LLM output validation |
| Database | PostgreSQL 16+ | Single system of record |
| Vector search | `pgvector`, HNSW, same database | Behind a `KnowledgeStore` interface |
| Data access | Drizzle ORM + `drizzle-kit` | RLS needs `SET LOCAL`; pgvector needs real SQL |
| Authentication | Better Auth, self-hosted | ADR-002 — identity only |
| Authorization | **Our own RBAC layer** | ADR-004 — never delegated |
| Tenant isolation | App scoping **+** PostgreSQL RLS | ADR-003 |
| Background jobs | `pg-boss` (Postgres-backed) | No new infrastructure |
| Object storage | Cloudflare R2, S3-compatible API | Zero egress; recordings are egress-heavy |
| Containerisation | Docker + Docker Compose | ADR-006 |
| Region | Indian region | ADR-006 — voice latency |
| Observability | OpenTelemetry + Pino + Sentry | Vendor-neutral |
| Testing | Vitest, Supertest, **Testcontainers** | RLS cannot be tested against a mock |

## A4. Infrastructure inventory — the complete list

| Component | Phase | Justification |
|---|---|---|
| One application container (API + dashboard) | 1 | The modular monolith |
| PostgreSQL + pgvector | 1 | System of record and vector store |
| One job worker process (`pg-boss`) | 1 | Document processing, notifications |
| Cloudflare R2 | 1 | Documents now, recordings later |
| Caddy reverse proxy | 1 | TLS termination |
| Voice Gateway process | 5 | Persistent audio sockets; same codebase |
| Redis | 5 | Ephemeral call state, cross-process pub/sub |

**Explicitly excluded, per founder instruction and `07_CODING_RULES` §3:**

❌ Microservices ❌ Kubernetes ❌ Kafka ❌ Service mesh ❌ A second database ❌ A separate vector database ❌ Dedicated GPU infrastructure ❌ Serverless functions on the voice path

Redis at Phase 5 is the only addition to this inventory, and it is justified by a concrete need (call state that must survive an API process restart and be visible across processes), not by anticipation.

## A5. Authentication and authorization boundary

This boundary is a hard architectural rule, not a convention.

```text
Better Auth                    Our authorization layer
─────────────                  ───────────────────────
Who are you?                   Which organization?
Are you logged in?             Which membership?
Which session?                 Which role?
Email verified?                Which permissions?
                               May you perform THIS action?
```

- Better Auth issues and validates sessions. It answers identity questions only.
- **Better Auth's own organization and role plugin features are not used as the authorization mechanism.** Organization, membership, role, and permission decisions are ours.
- Sessions are **opaque server-side tokens** in `httpOnly; Secure; SameSite=Lax` cookies. Not JWT — permissions are mutable and revocation must be instant.
- Provider webhooks authenticate by HMAC signature verification, never by user session.
- Future customer API access uses hashed, scoped, revocable API keys.

## A6. Tenant isolation — the engineering rule

> **No cross-tenant data access, even accidentally.**

Three layers, all required:

```text
1. Authorization      — does this membership hold the permission?
2. Explicit filtering — WHERE organization_id = $1 in the query
3. PostgreSQL RLS     — the database refuses anything else
```

Mechanism:

- Every organization-owned table: `organization_id UUID NOT NULL`, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, declared in the same migration that creates the table.
- Policy: `USING (organization_id = current_setting('app.current_org_id', true)::uuid)` with a matching `WITH CHECK`.
- The application connects as a **non-owner role** with no `BYPASSRLS`.
- A request-scoped transaction wrapper issues `SET LOCAL app.current_org_id`, derived **exclusively** from the server-side session's validated `active_organization_id`.
- Transaction-mode connection pooling only. Session-level `SET` is forbidden.
- Background jobs establish tenant context **per organization, per transaction** — never once per batch.
- Global tables exempt from RLS, enumerated exhaustively: `users`, `organizations`, system `roles`, `permissions`, `role_permissions`, `sessions`.

Failure mode by design: a forgotten filter returns **zero rows**, not another tenant's data.

## A7. Identity and tenancy model

```text
User (global identity, email globally unique)
 │
 ├── OrganizationMembership → Organization A → role: Owner
 ├── OrganizationMembership → Organization B → role: Recruiter
 └── OrganizationMembership → Organization C → role: Viewer
```

- `User.organization_id` **does not exist**. The role lives on the membership.
- A session carries one `active_organization_id`, set server-side and re-validated against an active membership on every request.
- Removing or suspending a membership immediately invalidates sessions scoped to that organization.
- Serves agencies, MSPs, consultancies, partner organizations, support staff, and multi-entity founders.

## A8. Permission model

- 51 permissions across 15 resource groups, bundled into 7 system roles. Full matrix in `11_PERMISSION_MATRIX.md`.
- **Code checks permission strings, never role names.** `requires('agents.deploy')`, never `role === 'admin'`.
- Every non-public route declares a required permission; undeclared routes fail closed.
- Personal data is separately gated: `candidates.read_pii`, `calls.read_transcript`, `calls.read_recording`, `candidates.export`. Every such read writes an `AuditEvent`.
- **Agent tools resolve through this same layer.** An agent cannot perform an action the initiating membership lacks. Prompts are not a security boundary.

## A9. Provider independence

Interfaces defined; implementations added only when their phase arrives.

| Interface | Phase defined | Phase implemented |
|---|---|---|
| `LLMProvider` | 1 | 4 |
| `EmbeddingProvider` | 1 | 3 |
| `KnowledgeStore` | 1 | 3 |
| `NotificationProvider` | 1 | 1 (email only) |
| `VoicePipeline` | **1** | 5 |
| `TelephonyProvider` | 1 | 5 |
| `SpeechToTextProvider` | 1 | 5 |
| `TextToSpeechProvider` | 1 | 5 |
| `CalendarProvider` | 1 | 6 |
| `CRMProvider` / ATS | 1 | 6 |

**No provider is embedded.** Twilio, Plivo, Exotel, Sarvam, Deepgram, ElevenLabs, OpenAI, Anthropic, Google, and xAI are candidates behind adapters. Replacing any of them must not change agent definitions, workflows, the dashboard, the organization model, the candidate model, or business logic.

Customer-facing configuration exposes **capabilities** — intelligence level, voice quality, language, calling capacity — never provider names.

## A10. Agent runtime shape — ADR-007

```text
❌ AgentRuntime.handle(message) → response
✅ AgentSession: inbound event stream → outbound event stream
```

The runtime is a **stateful, stream-shaped session** from Phase 1. Text chat is the degenerate one-event case of the same loop, not a different mechanism.

Accommodated from the start: continuous multi-turn conversation, streaming input and output, interruption/barge-in, mid-conversation tool calls, the three distinct memory types, audio and lifecycle events, cancellation and timeout.

The `VoicePipeline` interface is defined in Phase 1. **No voice implementation is built until Phase 5.**

---

# B. MVP IMPLEMENTATION

Phases from `08_DEVELOPMENT_WORKFLOW.md`, now bound to approved decisions.

| Phase | Scope | Introduces |
|---|---|---|
| **1 — Foundation** | Auth, organizations, memberships, invitations, roles, permissions, RLS, migrations, APIs, tests, local dev | Better Auth, Drizzle, RLS, RBAC, pg-boss, Testcontainers |
| **2 — Agent foundation** | Agent CRUD, versions, configuration, **`AgentSession` contract + text implementation** | ADR-007 runtime shape |
| **3 — Knowledge** | Upload, parse, chunk, embed, pgvector, retrieval, permissions | `EmbeddingProvider`, `KnowledgeStore`, R2 |
| **4 — Intelligence** | LLM abstraction, structured output, conversation state, tool framework, guardrails | `LLMProvider`, Zod output validation |
| **5 — Voice** | Voice Gateway process, telephony/STT/TTS adapters, streaming, call state, webhooks | Redis, `VoicePipeline` implementation |
| **6 — Recruitment** | Jobs, candidates, screening, evaluation, scheduling, follow-up | `CalendarProvider`, ATS/CRM |
| **7 — Economics** | Usage metering, cost events, limits, alerts, billing foundation | — |
| **8 — Hardening** | Security, observability, failure handling, performance, end-to-end | — |

MVP scope and deferrals remain as stated in `02_BRD.md` §15.

---

# C. FUTURE / DEFERRED ARCHITECTURE

Recorded so nobody builds them early. Each is possible under the approved architecture without redesign.

| Item | Trigger to revisit |
|---|---|
| Service extraction (API, Voice Gateway, Knowledge, Workflow, Billing) | Demonstrated scale or a real bottleneck — never before |
| Redis for call state | Phase 5 |
| Managed PostgreSQL | Before the first real customer's data lands |
| Horizontal scaling of the Voice Gateway | Concurrent call volume; requires externalised call state |
| Custom organization-defined roles | Customer demand; schema already supports it |
| Record-level permission scoping ("my candidates only") | Customer demand; extension point defined in ADR-004 |
| Enterprise SSO / SAML | Enterprise deal; identity model already compatible |
| Multi-factor authentication | Post-MVP; Better Auth plugin |
| Python voice gateway | Only if Node's turn-taking and barge-in prove inadequate at Phase 5 |
| A dedicated vector database | Only if pgvector demonstrably fails at real corpus size |
| Provider routing by cost/quality/latency | Post-MVP; MVP uses explicit configuration and basic fallback |
| White-label, custom domains, agent marketplace | Per `02_BRD.md` §15 |
| Global expansion beyond India | Phase 2 of the geographic strategy |

---

# D. OPEN EXPERIMENTAL DECISIONS

**Not approved. Must be resolved by real measurement before money is committed.** Per `06_PROVIDER_AND_COST_SPEC.md` §16, decisions here come from benchmark results, never vendor marketing.

## D1. Hosting vendor — the ADR-006 condition

The *architecture* is approved: Indian region, always-on container, persistent WebSocket, no serverless on the voice path. The **vendor is not**.

Candidates: DigitalOcean Bangalore · AWS Lightsail Mumbai · Fly.io `bom` · Linode/Akamai Mumbai.

Must be measured before commitment:

```text
VPS → real telephony provider → real Indian phone number
    → real audio stream → STT → LLM → TTS → candidate
```

Recorded per candidate: total round-trip latency and its per-segment breakdown, packet loss and jitter, sustained concurrent call capacity, failure rate, actual monthly cost at realistic load.

## D2. Every AI and telephony provider

No telephony, STT, TTS, LLM, or embedding provider is selected. All remain candidates behind adapters, to be chosen on benchmark evidence at their phase — against the criteria in `06_PROVIDER_AND_COST_SPEC.md` §3, with Indian-language quality, code-mixing, and streaming weighted heavily.

## D3. Other open items

| Item | Needed by |
|---|---|
| Transactional email provider (behind `NotificationProvider`) | Phase 1 |
| Managed PostgreSQL provider and migration timing | Before first customer |
| Actual voice latency budget, validated against the ~1.2s target | Phase 5 |
| Customer pricing and unit economics | After real provider testing |
| Data retention periods for recordings and transcripts | Before first customer |

---

# E. EXPENSIVE-TO-CHANGE DECISIONS

The permanent record of what is now locked, and what it would cost to reopen.

| # | Decision | Cost to reverse | Why |
|---|---|---|---|
| 1 | PostgreSQL RLS as the isolation backstop | **Very high** | Retrofitting means auditing every table, query, job, and the pooling layer — with the system exposed throughout |
| 2 | Membership model; role on membership | **Very high** | Identity migration against live sessions |
| 3 | Globally unique email on `users` | **Very high** | Splitting or merging identities after accounts exist is painful and user-visible |
| 4 | TypeScript as the platform language | **Very high** | Full rewrite of every service, test, and migration |
| 5 | PostgreSQL as system of record | **Very high** | RLS and pgvector both assume it |
| 6 | Indian region | **Very high** | Latency is structural; residency commitments are hard to walk back |
| 7 | Stream-shaped agent runtime (ADR-007) | **Very high** | A request/response runtime is a rewrite at Phase 5, not an extension |
| 8 | Permission granularity for personal data | **High** | Once code assumes candidate reads are all-or-nothing, splitting means auditing every read path |
| 9 | Permission strings rather than role checks | **High** | Scattered role conditionals must all be found |
| 10 | In-process call state without an externalisation interface | **High** | Retrofitting distributed state under a working voice pipeline |
| 11 | Opaque sessions vs JWT | Moderate | Touches every client and authorization check |
| 12 | Drizzle vs another ORM | Moderate | Schema is portable; queries and the RLS wrapper are not |
| 13 | Managed auth provider adoption | **Very high** *(avoided)* | Password hashes may be unexportable — the reason self-hosted was chosen |
| 14 | Hosting vendor (not region) | Low–moderate | Deliberately cheap via Docker and 12-factor config |
| 15 | Object storage provider | Low | S3-compatible API |
| 16 | Job queue | Low | Small surface behind an interface |
| 17 | Observability backend | Low | OpenTelemetry is vendor-neutral |

---

# PHASE 1 IMPLEMENTATION BOUNDARY

The exact scope of the first implementation task. Anything not listed under IN SCOPE is out of scope.

## IN SCOPE

**Project foundation**
- Repository structure, TypeScript `strict` configuration, linting, formatting
- Docker Compose for local development: application, PostgreSQL + pgvector, job worker
- Environment configuration and validation (Zod), `.env.example`, **no committed secrets**
- Database migration tooling (`drizzle-kit`)

**Authentication (ADR-002)**
- Better Auth wired to PostgreSQL for identity and sessions only
- Email/password registration, login, logout, email verification, password reset
- Opaque server-side sessions in `httpOnly; Secure; SameSite=Lax` cookies
- Session invalidation on deactivation, membership removal, and role change
- Transactional email behind `NotificationProvider`

**Organizations and membership (ADR-005)**
- `organizations`, `users`, `organization_memberships`, `organization_invitations`, `sessions`
- Organization creation — creator becomes Owner
- Invitation by email, acceptance, revocation, expiry
- Multi-organization membership with a different role per organization
- Server-set `active_organization_id`; organization switching with re-validation

**Roles and permissions (ADR-004)**
- `roles`, `permissions`, `role_permissions`
- All 51 permissions and 7 system roles seeded by migration exactly as `11_PERMISSION_MATRIX.md` specifies
- Permission-checking guard; every non-public route declares its required permission
- Structural invariants: last Owner protected; only Owner grants Owner; Administrator cannot modify an Owner; no self-escalation

**Tenant isolation (ADR-003)**
- `organization_id` on every organization-owned table
- RLS enabled and forced, in the creating migration
- Non-owner application database role; separate privileged migration role
- Request-scoped transaction wrapper issuing `SET LOCAL app.current_org_id`
- Transaction-mode pooling configuration

**Interfaces only — no implementations (ADR-007, ADR-001)**
- `VoicePipeline`, `TelephonyProvider`, `SpeechToTextProvider`, `TextToSpeechProvider`
- `LLMProvider`, `EmbeddingProvider`, `KnowledgeStore`, `CalendarProvider`, `CRMProvider`
- `AgentSession` stream-shaped runtime contract
- **Type declarations only. No provider SDK dependencies. No adapter implementations.**

**Background jobs**
- `pg-boss` configured; email delivery as the only job type
- Tenant context established per organization, per transaction

**Audit**
- `audit_events` table; writes on authentication events, membership and role changes, and permission denials

**API**
- Consistent error format with `code`, `message`, `request_id`, field errors
- Zod validation at every boundary; pagination, filtering, sorting conventions
- Rate limiting
- Endpoint groups: Auth, Organizations, Memberships, Invitations, Roles, Users, Audit

**Frontend**
- Next.js shell, login, registration, invitation acceptance
- Organization switcher; permission-aware navigation
- Users and invitations screen; organization settings

**Testing**
- Unit tests for authorization logic
- Integration tests against real PostgreSQL via Testcontainers
- **Tenant-isolation tests:** cross-organization read, write, and insert all rejected; unset tenant context returns zero rows
- **Schema-drift test:** every table with `organization_id` has RLS enabled and forced
- **Route-coverage test:** no non-public route lacks a declared permission
- Permission matrix tests across all 51 × 7 combinations
- Privilege-escalation tests

**Observability**
- Pino structured logging with request IDs; OpenTelemetry initialised
- **Never log** credentials, tokens, session values, or candidate personal data

## OUT OF SCOPE — do not build in Phase 1

❌ Agents, agent versions, agent configuration ❌ Agent runtime implementation beyond the interface ❌ Knowledge, documents, parsing, chunking, embeddings, RAG ❌ LLM calls of any kind ❌ Voice, telephony, STT, TTS, audio, media sockets ❌ Any provider SDK or adapter implementation ❌ Jobs, candidates, screening, evaluation, scheduling ❌ Workflows and the workflow engine ❌ Integrations — calendar, ATS, CRM ❌ Usage metering, cost events, billing, subscriptions ❌ Analytics ❌ Custom roles ❌ Record-level permission scoping ❌ MFA, SSO, SAML ❌ Redis ❌ Production deployment pipeline

## Definition of done for Phase 1

1. All tests pass, including tenant-isolation, schema-drift, route-coverage, and permission-matrix tests.
2. A user can register, create an organization, invite a second user, and that user can accept and receive the assigned role.
3. A user belonging to two organizations can switch between them, and data and permissions change correctly with no leakage.
4. Cross-tenant access is impossible through the API and through direct SQL under the application role.
5. No secret is committed.
6. A completion report is produced per `07_CODING_RULES_FOR_CLAUDE.md` §18.

---

# Consistency check

| Check | Result |
|---|---|
| All seven ADR decisions incorporated | ✅ |
| Existing specification files corrected | ✅ — see `13_SPEC_CHANGES_REQUIRED.md` |
| `User.organization_id` removed everywhere | ✅ |
| Authentication marked "open decision" anywhere | ✅ resolved |
| Permission matrix defined and referenced | ✅ |
| Tenant isolation mechanism specified | ✅ |
| Stack named in the architecture document | ✅ |
| Deployment target specified | ✅ |
| `VoicePipeline` interface required in Phase 1 | ✅ |
| No provider permanently embedded | ✅ |
| No microservices, Kubernetes, or Kafka introduced | ✅ |
| No new infrastructure beyond the A4 inventory | ✅ |
| Contradictory specification remaining | ✅ none found |

---

# ARCHITECTURE READY FOR PHASE 1

All seven ADR decisions are incorporated consistently across the specification pack. No contradictory specification remains.

Two conditions carry forward and do **not** block Phase 1, because Phase 1 touches neither hosting nor providers:

1. **Hosting vendor selection** (§D1) remains experimentally open and must be benchmark-validated before any spend.
2. **All AI and telephony provider selection** (§D2) remains open, behind adapters, until each provider's phase arrives.

Phase 1 implementation may begin on founder instruction.
