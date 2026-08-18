# System Architecture v0.2

> Updated 2026-08-16 to incorporate ADR-001 … ADR-007.
> **Authoritative companion:** `12_ARCHITECTURE_DECISIONS_FINAL.md`.

## 1. Architectural objective

The architecture must:

1. Stay compatible with the bootstrap budget.
2. Provide a high-quality real-time voice experience.
3. Keep major providers replaceable.
4. Support multiple business use cases.
5. Provide strong multi-tenant isolation.

## 2. Architectural style

Start as a modular monolith.

Do not begin with unnecessary microservices, Kubernetes, Kafka, service meshes, dedicated GPUs, or multiple databases.

### Approved stack (ADR-001)

| Layer | Technology |
|---|---|
| Language | TypeScript, `strict: true` |
| Frontend | Next.js (App Router), Tailwind, shadcn/ui, TanStack Query |
| Backend | NestJS on Fastify |
| Validation | Zod |
| Database | PostgreSQL 16+ with `pgvector` |
| Data access | Drizzle ORM + `drizzle-kit` migrations |
| Authentication | Better Auth, self-hosted (identity only) |
| Authorization | Our own RBAC layer + PostgreSQL RLS |
| Background jobs | `pg-boss` |
| Object storage | Cloudflare R2 (S3-compatible) |
| Observability | OpenTelemetry, Pino, Sentry |
| Testing | Vitest, Supertest, Testcontainers |
| Runtime packaging | Docker + Docker Compose |

NestJS modules map onto the logical module list below, and the DI container is the enforcement point for provider adapters.

### Process topology

The monolith runs as **multiple entrypoints from one codebase**, not as multiple services:

- **API + dashboard** — Phase 1
- **Job worker** (`pg-boss`) — Phase 1
- **Voice Gateway** — Phase 5, holds persistent audio sockets so an API deploy never drops a live call

Logical modules may include:

- auth
- organizations
- users
- roles
- agents
- knowledge
- conversations
- candidates
- jobs
- workflows
- integrations
- usage
- costs
- billing
- analytics
- provider adapters

They can initially run in one backend application.

## 3. High-level architecture

```text
Web Dashboard
     |
     v
Platform Backend
     |
     +-- Auth / Organizations / Users / Roles
     +-- Agents / Knowledge / Candidates / Workflows
     +-- Integrations / Usage / Billing / Analytics
     |
     v
Agent Runtime
     |
     +-- Context
     +-- Memory
     +-- Rules
     +-- Guardrails
     +-- RAG
     +-- Tool execution
     +-- Workflow
     |
     +----------------+----------------+
     |                |                |
     v                v                v
 LLM Adapter     Knowledge        Tool Adapter
     |                |                |
 LLM Providers   PostgreSQL +      Calendar/ATS/
                 pgvector          CRM/APIs
     |
     v
Speech Pipeline
     |
   STT / TTS
     |
     v
Telephony Adapter
     |
     v
Customer
```

## 4. Database

PostgreSQL is the primary system of record.

Initial entities:

- Organization
- User — **global identity; not organization-owned** (ADR-005)
- OrganizationMembership — carries the user↔organization relationship and the role
- OrganizationInvitation
- Session
- Role
- Permission
- RolePermission
- Subscription
- Agent
- AgentVersion
- KnowledgeSource
- KnowledgeDocument
- KnowledgeChunk
- Job
- Candidate
- Conversation
- Message
- Call
- Evaluation
- Workflow
- WorkflowRun
- Action
- Integration
- UsageEvent
- CostEvent
- AuditEvent

## 5. Tenant isolation

> **Engineering rule: no cross-tenant data access, even accidentally.**

Every organization-owned resource must be associated with an organization.

Authorization must verify:

User → OrganizationMembership → Organization → Resource

before returning or modifying data.

Enforcement is at **three layers, all required** (ADR-003):

1. **Authorization** — does this membership hold the required permission?
2. **Explicit filtering** — every organization-owned query filters on `organization_id`.
3. **PostgreSQL row-level security** — the database refuses anything else.

Mechanism:

- `organization_id UUID NOT NULL` on every organization-owned table.
- `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`, declared in the migration that creates the table.
- Policy on `current_setting('app.current_org_id', true)::uuid`, with a matching `WITH CHECK`.
- The application connects as a **non-owner database role** with no `BYPASSRLS`; migrations use a separate privileged role.
- A request-scoped transaction wrapper issues `SET LOCAL app.current_org_id`, derived exclusively from the authenticated server-side session — never from client input.
- **Connection pooling is security-relevant.** Transaction-mode pooling with `SET LOCAL` inside an explicit transaction is a required invariant; session-level `SET` is forbidden.
- Background jobs establish tenant context per organization and per transaction, never once per batch.
- Global tables exempt from RLS, enumerated exhaustively: `users`, `organizations`, system `roles`, `permissions`, `role_permissions`, `sessions`.

Failure mode by design: a forgotten filter returns **zero rows**, not another tenant's data.

Tenant isolation is a critical security requirement.

## 5a. Identity and tenancy model

```text
User (global identity, email globally unique)
 │
 ├── OrganizationMembership → Organization A → role: Owner
 ├── OrganizationMembership → Organization B → role: Recruiter
 └── OrganizationMembership → Organization C → role: Viewer
```

A user may belong to many organizations and hold a different role in each. The role lives on the **membership**, never on the user. A session carries one server-set `active_organization_id`, re-validated on every request.

## 6. Agent model

Agents are configuration, not separate codebases.

Agent configuration includes:

- Purpose
- Instructions
- Knowledge
- Questions
- Rules
- Guardrails
- Voice
- Language
- Tools
- Actions
- Escalation
- Follow-up
- Evaluation

## 7. Agent runtime

The runtime is a **stateful, stream-shaped session**, not a request/response handler (ADR-007).

```text
❌ AgentRuntime.handle(message) → response
✅ AgentSession: inbound event stream → outbound event stream
```

Text chat is the degenerate one-event case of the same loop, not a separate mechanism that voice is later retrofitted onto.

Session inputs:

- Inbound event stream — text, audio frames, lifecycle and control events
- Agent configuration
- Conversation state
- Knowledge
- Business rules
- Available tools

Per-turn processing:

1. Load state.
2. Retrieve relevant knowledge.
3. Apply agent rules.
4. Invoke intelligence layer.
5. Determine whether an action is needed.
6. Validate action authorization **through the permission layer**.
7. Execute action if allowed.
8. Emit response events, streaming where the transport supports it.
9. Persist state/events.

The runtime must accommodate, from Phase 1: continuous multi-turn conversation, streaming input and output, interruption and barge-in, mid-conversation tool calls, the three distinct memory types in §13, audio and lifecycle events, and cancellation with timeout.

The `VoicePipeline` interface is **defined in Phase 1**. No voice implementation is built until Phase 5.

## 8. Knowledge architecture

Initial:

Document
→ Parse
→ Chunk
→ Embed
→ PostgreSQL + pgvector
→ Retrieve
→ Context
→ LLM

The knowledge layer should be abstracted so another vector store can be introduced later.

## 9. Provider abstraction

External provider SDKs must be isolated behind adapters.

Required conceptual interfaces, with the phase each is **defined** and the phase each is **implemented**:

| Interface | Defined | Implemented |
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

Business services must not directly depend on provider SDKs.

**No provider is embedded.** Twilio, Plivo, Exotel, Sarvam, Deepgram, ElevenLabs, OpenAI, Anthropic, Google, and xAI are candidates behind adapters, selected on benchmark evidence at their phase. Replacing any of them must not change agent definitions, workflows, the dashboard, the organization model, the candidate model, or business logic.

## 10. Voice pipeline

Customer
→ Telephony
→ Audio stream
→ STT
→ Agent Runtime
→ RAG/Rules/Memory/LLM/Tools
→ TTS
→ Telephony
→ Customer

Streaming should be used where required for conversational latency.

## 11. Workflow architecture

Use generic workflows rather than recruitment-only workflows.

Concept:

Trigger
→ Condition
→ Agent interaction
→ Action
→ Condition
→ Follow-up

Recruitment is the first implementation of this generic model.

## 12. Tools/actions

Agents receive explicit, permission-controlled tools.

Each tool should have:

- Name
- Description
- Input schema
- Output schema
- Permissions
- Organization scope
- Agent assignment

Never give the LLM unrestricted system/API access.

**Agent tool authorization resolves through the same permission layer as human authorization** (ADR-004). An agent cannot perform an action the initiating membership lacks permission for. A prompt injection therefore cannot grant capability, because the capability check does not live in the prompt.

## 13. Memory

Separate:

- Conversation memory
- Structured business memory
- Organization knowledge

These must not be treated as interchangeable.

## 14. Guardrails

Guardrails must exist at both:

- Agent/configuration level
- Backend authorization/tool layer

Prompts are not a security boundary.

## 15. Events

Record important events such as:

- agent_created
- call_started
- call_completed
- knowledge_retrieved
- tool_requested
- tool_completed
- candidate_screened
- candidate_qualified
- interview_scheduled
- provider_failed
- provider_fallback
- usage_recorded

These support analytics, debugging, cost tracking, and auditing.

## 16. Cost architecture

External provider operations should produce usage/cost events.

Example:

Call
→ Telephony cost
→ STT cost
→ TTS cost
→ LLM cost
→ Other costs
→ Total internal cost

## 17. Background jobs

Mechanism: **`pg-boss`**, backed by the existing PostgreSQL instance. No additional infrastructure (ADR-001).

Background jobs must establish tenant context **per organization and per transaction** — never once per batch (ADR-003).

Use background processing for:

- Document processing
- Embeddings
- Knowledge indexing
- Analytics aggregation
- Usage calculations
- Follow-up scheduling
- Notifications
- Post-call processing

Use a lightweight queue/job mechanism initially.

## 18. Webhooks

All external webhooks must:

1. Verify authenticity.
2. Identify provider.
3. Identify organization.
4. Validate payload.
5. Process idempotently.
6. Record event.
7. Return an appropriate response.

## 19. Idempotency

Required for:

- Calendar booking
- CRM/ATS updates
- Payments
- Candidate status
- Webhooks
- Workflow actions

Duplicate events must not create duplicate business outcomes.

## 20. Observability

Provide:

- Logs
- Metrics
- Traces where useful

Important voice traces should make it possible to understand:

Telephony → STT → Agent → RAG → LLM → TTS → Telephony

## 21. Deployment

Decided in ADR-006.

**Phases 1–4:** a single Docker Compose stack on one **Indian-region VPS** — Caddy (TLS), Next.js dashboard, NestJS API, PostgreSQL + pgvector, `pg-boss` worker — with Cloudflare R2 for object storage. Indicative cost ₹2,000–4,500/month, leaving the majority of the ₹10,000 target for provider usage.

**Phase 5:** add the Voice Gateway as a second process from the same codebase, plus Redis for ephemeral call state.

**Database progression:** PostgreSQL in Docker for development; migrate to managed PostgreSQL in an Indian region **before the first real customer's data lands**. Until then, automated `pg_dump` to R2 plus WAL archiving, **with a restore actually tested**.

### Why an Indian region is required

The conversational latency budget is roughly 700–1700 ms end-to-end before geography is considered:

| Segment | Typical |
|---|---|
| Endpointing / VAD | 200–400 ms |
| STT finalisation | 50–200 ms |
| LLM time-to-first-token | 300–700 ms |
| TTS time-to-first-byte | 100–300 ms |
| Network legs within India | 40–120 ms |

Hosting compute outside India adds roughly **150–250 ms of round trip on the telephony leg, paid on every conversational turn**. Target: under ~1.2s from end of candidate speech to first returned audio byte, p50.

### Why not serverless on the voice path

Outbound calling works as: we originate over REST → the provider dials → **the provider opens a media socket back to us** → the Voice Gateway holds that socket for the call duration with in-process state.

This requires a stable, publicly reachable, always-on `wss://` endpoint. Request-response serverless fails on cold starts, execution time limits, and the absence of a persistent process.

### Portability constraints

Everything runs in Docker with strict 12-factor configuration and no dependency on a host-proprietary service beyond S3-compatible object storage. Moving to Fly.io `bom` or AWS `ap-south-1` must remain a deployment change, not an architectural one.

### Open

**The specific hosting vendor is not selected.** The architecture is approved; vendor and cost selection remains an open experimental decision pending real end-to-end benchmarking. See `12_ARCHITECTURE_DECISIONS_FINAL.md` §D1.

Prefer low-idle-cost infrastructure.

## 22. Future scaling

Components may later be extracted into services such as:

- API
- Agent Runtime
- Voice Gateway
- Knowledge
- Workflow
- Integrations
- Usage/Cost
- Analytics
- Billing

Only extract based on actual scale or bottlenecks.
