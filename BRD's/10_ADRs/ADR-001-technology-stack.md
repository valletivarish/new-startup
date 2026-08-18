# ADR-001 — Technology Stack

**Status:** ACCEPTED — approved by founder, 2026-08-16
**Date:** 2026-08-16
**Supersedes:** nothing (no stack was previously specified in the spec pack)

---

## Context

No document in the spec pack names a language, framework, or runtime. `03_SYSTEM_ARCHITECTURE.md` describes "Platform Backend" and "Web Dashboard" as boxes on a diagram. Nothing can be built until this is decided.

The choice is dominated by one constraint that most CRUD platforms do not have: **real-time voice**. The system must hold long-lived bidirectional audio WebSockets, run streaming STT, streaming LLM, and streaming TTS inside a sub-1.2s conversational latency budget, while also being a conventional multi-tenant SaaS dashboard.

Secondary constraints: a ~₹10,000/month total operating budget, a very small team, a modular-monolith mandate, and a hard requirement that provider SDKs stay behind adapters.

---

## Options considered

### Option A — TypeScript everywhere (NestJS backend + Next.js frontend)

**Advantages**
- One language across frontend, backend, and voice pipeline. For a team of one or two, this roughly halves context-switching cost.
- Node's event loop is well suited to the actual voice workload, which is I/O relay (socket → socket) rather than computation.
- Shared types between API and dashboard eliminate a whole class of contract bugs without extra tooling.
- NestJS modules map almost 1:1 onto the module list in `03_SYSTEM_ARCHITECTURE.md` §2 (auth, organizations, agents, knowledge, …), and its dependency-injection container is a natural enforcement point for provider adapters — you inject an `LLMProvider` interface and bind the implementation at configuration time.
- Largest hiring pool and largest ecosystem at this budget tier.

**Disadvantages**
- CPU-bound audio work (resampling, voice-activity detection) is awkward on a single thread; needs worker threads or native addons if we ever do it in-process rather than at the provider.
- The AI/ML ecosystem is Python-first. Some provider SDKs ship Python before TypeScript, and we may occasionally use REST directly instead of an official SDK.
- NestJS carries decorator/DI ceremony that feels heavy in the first two weeks.

### Option B — Python backend (FastAPI) + React/Next frontend

**Advantages**
- Best-in-class AI ecosystem; nearly every provider ships a Python SDK first.
- Purpose-built open-source voice-agent frameworks (Pipecat, LiveKit Agents) are Python, and they solve endpointing, barge-in, and turn-taking — genuinely hard problems we would otherwise build ourselves.
- FastAPI + Pydantic gives strong runtime validation of structured LLM output, which `07_CODING_RULES_FOR_CLAUDE.md` §12 explicitly requires.

**Disadvantages**
- Two languages, two toolchains, two test setups, no shared types across the API boundary.
- The GIL complicates many concurrent in-process audio sessions; asyncio handles the I/O fine, but any CPU work per stream contends.
- Heavier container images and slower startup, which matters when redeploying an always-on voice process.

### Option C — Go backend + React frontend

**Advantages**
- Best concurrency model of the three for many simultaneous audio streams; goroutines per call are cheap.
- Lowest memory footprint, which directly reduces hosting cost — meaningful against a ₹10,000 ceiling.
- Single static binary makes deployment trivial.

**Disadvantages**
- Materially slower feature development for CRUD, dashboards, and migrations — and Phases 1–4 are almost entirely CRUD.
- Weakest AI SDK ecosystem of the three; more hand-rolled HTTP clients.
- ORM and migration tooling is less ergonomic than the TS or Python equivalents.

### Option D — Hybrid (TypeScript platform + Python voice service)

**Advantages**
- Uses each ecosystem where it is genuinely strongest.

**Disadvantages**
- Directly violates the modular-monolith mandate in `03_SYSTEM_ARCHITECTURE.md` §2 at the exact moment the doc warns against premature service splits.
- Two deploy targets, two auth integrations, duplicated model definitions, and cross-service tenant-context propagation — all before a single customer exists.
- Rejected for Phase 1. Revisit only if voice-pipeline quality becomes the binding constraint (see Consequences).

---

## Evaluation

| Criterion | A: TypeScript | B: Python | C: Go | D: Hybrid |
|---|---|---|---|---|
| ₹10k/month budget | Good — modest memory | Fair — heavier images | Best — lowest footprint | Poor — two deploy targets |
| Real-time voice | Good — strong streaming/WS | Best — mature voice frameworks | Good — best concurrency | Best, at high cost |
| Multi-tenancy | Good | Good | Good | Fair — context crosses a boundary |
| Security | Good — mature auth/validation libs | Good | Good | Fair — larger attack surface |
| Maintainability | Best — one language | Fair — two languages | Fair — verbose | Poor for a small team |
| Development speed | Best | Good | Poor for CRUD | Poor |
| Future scalability | Good | Good | Best | Best |
| Provider independence | Good — DI enforces adapters | Good | Good | Neutral |

---

## Decision

**Option A — TypeScript across the stack.** Concretely:

| Layer | Choice | Note |
|---|---|---|
| Frontend | Next.js (App Router) + TypeScript | Desktop-first per `05_UX_DASHBOARD_SPEC.md` §18, responsive |
| UI | Tailwind CSS + shadcn/ui + Radix primitives | Radix gives the keyboard/ARIA behaviour §19 requires |
| Data fetching | TanStack Query | Cache invalidation on permission/org switch |
| Backend | NestJS on the Fastify adapter | Modules mirror architecture §2; DI hosts provider adapters |
| Language | TypeScript, `strict: true` | Satisfies "typed request/response contracts" (coding rules §3) |
| Database | PostgreSQL 16+ with `pgvector` | Single system of record per architecture §4 |
| Data access | Drizzle ORM + `drizzle-kit` migrations | See rationale below |
| Validation | Zod, shared between API and dashboard | Also validates structured LLM output before persistence |
| Authentication | Better Auth, self-hosted — see ADR-002 | |
| Authorization | Custom permission layer + Postgres RLS — see ADR-003/004 | |
| Background jobs | `pg-boss` (Postgres-backed) | No new infrastructure in Phase 1 |
| Object storage | Cloudflare R2 via the S3-compatible API | Zero egress fees; recordings are egress-heavy |
| Vector search | `pgvector` with HNSW indexes, in the primary database | Behind a `KnowledgeStore` interface |
| Deployment | Docker + Docker Compose — see ADR-006 | |
| Observability | OpenTelemetry SDK, Pino structured logs, Sentry | Vendor-neutral by design |
| Testing | Vitest, Supertest, Testcontainers, Playwright (later) | Testcontainers is required — see below |

### Why Drizzle over Prisma

This is the least obvious call in the stack, so it is recorded explicitly.

Prisma has better-known migration tooling and a larger community. Drizzle wins here on three project-specific grounds:

1. **RLS needs `SET LOCAL` inside an explicit transaction** (ADR-003). Drizzle's thin driver layer makes wrapping every request transaction straightforward; Prisma's query engine sits between the app and the connection and makes this awkward.
2. **`pgvector` similarity queries need real SQL** — operators, index hints, and hybrid keyword+vector ranking. Drizzle is SQL-first; Prisma pushes this into raw escape hatches that lose type safety.
3. **Connection pooling behaviour** is more predictable with a thin layer, which matters for a long-lived voice process holding connections.

### Why Testcontainers is non-negotiable

Tenant isolation will be enforced partly by PostgreSQL row-level security. **RLS policies cannot be tested against a mocked or in-memory database.** The tenant-isolation tests demanded by `07_CODING_RULES_FOR_CLAUDE.md` §4 and `09_MVP_ACCEPTANCE_CRITERIA.md` are only meaningful against real PostgreSQL. Testcontainers is therefore a correctness requirement, not a convenience.

---

## Rationale

The dominant risk at this stage is not scale — it is not shipping. Phases 1 through 4 are conventional multi-tenant CRUD with an LLM abstraction, and TypeScript is the fastest safe path through that for a very small team. Voice does not arrive until Phase 5, by which time the platform, tenancy model, and cost accounting must already be solid.

Go's concurrency advantage is real but pays off at a call volume this product will not see for a long time, and it taxes every day of Phase 1–4 development to get there. Python's voice-framework advantage is the strongest counter-argument, and it is explicitly preserved as an escape hatch below rather than dismissed.

---

## Consequences

- Voice pipeline components must be written behind a `VoicePipeline` interface, so that if Node's turn-taking and barge-in quality proves inadequate in Phase 5, a Python voice gateway can be introduced as a *second process against the same database* without touching the platform code. This is the deliberate escape hatch for Option D.
- Node-side CPU work must be avoided in the audio path. Prefer provider-side VAD and endpointing over in-process DSP.
- Some provider integrations will use REST directly rather than an official SDK. Given that coding rules §5 requires adapters anyway, this is a minor cost and arguably reduces lock-in.

---

## Expensive to change later

| Item | Cost to reverse | Why |
|---|---|---|
| Backend language | **Very high** | Full rewrite of every service, test, and migration |
| ORM (Drizzle ↔ Prisma) | Moderate | Schema is portable; every query and the RLS transaction wrapper are not |
| PostgreSQL as primary store | **Very high** | Assumed by RLS (ADR-003) and pgvector; the whole isolation model depends on it |
| Frontend framework | Low–moderate | The API contract is the durable artifact |
| Job queue (`pg-boss` → BullMQ) | Low | Small, well-isolated surface, deliberately kept behind an interface |
| Object storage | Low | S3-compatible API keeps R2/S3/B2 interchangeable |
