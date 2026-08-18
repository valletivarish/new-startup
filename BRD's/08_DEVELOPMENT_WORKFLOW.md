# Development Workflow

## Purpose

This file defines how AI-assisted development should be performed.

## Roles

### Product/Architecture owner

The project owner and architecture process determine what is built and approve major decisions.

### Primary implementation AI

Claude Code.

### Independent reviewer

Grok or another independent model can review implementation for:

- Security
- Architecture
- Cost leaks
- Provider lock-in
- Missing requirements
- Edge cases

### Final review

Implementation should not be considered complete until tests pass and the relevant acceptance criteria are checked.

## Workflow

```text
Approved specification
        ↓
Small implementation task
        ↓
Claude Code
        ↓
Automated tests
        ↓
Manual verification
        ↓
Independent review
        ↓
Fixes
        ↓
Acceptance
        ↓
Next task
```

## First implementation phases

### Phase 1 — Foundation

- Project setup (TypeScript, Docker Compose, migrations)
- Authentication — Better Auth, opaque server-side sessions
- Organizations
- **Organization memberships**
- **Invitations**
- Users (global identities)
- Roles
- **Permission matrix seeding — all 51 permissions, 7 system roles**
- **Row-level security policies**
- Tenant isolation, with cross-tenant tests against real PostgreSQL
- **Provider interface definitions only — no implementations, no provider SDKs**

The exact Phase 1 boundary, including the out-of-scope list and the definition of done, is in `12_ARCHITECTURE_DECISIONS_FINAL.md`.

### Phase 2 — Agent foundation

- Agent CRUD
- Agent versions
- Configuration
- **`AgentSession` stream-shaped runtime contract, plus a text implementation** (ADR-007)

> The runtime must not be built as `handle(request) → response`. Text chat is the degenerate one-event case of the streaming session, not a separate mechanism.

### Phase 3 — Knowledge

- Document upload
- Parsing
- Chunking
- Embeddings
- pgvector
- Retrieval
- Knowledge permissions

### Phase 4 — Intelligence

- LLM abstraction
- Structured output
- Conversation state
- Tool framework
- Guardrails

### Phase 5 — Voice

- Voice Gateway process (second entrypoint, same codebase)
- `VoicePipeline` implementation against the Phase 1 interface
- Telephony adapter
- STT adapter
- TTS adapter
- Streaming
- Call state (Redis introduced here)
- Webhooks

> Entry check: it must be demonstrable that a voice transport can be added **without modifying the agent runtime**. If that is false, the runtime shape was wrong and the fix belongs in Phase 2.

### Phase 6 — Recruitment

- Jobs
- Candidates
- Screening
- Evaluation
- Scheduling
- Follow-up

### Phase 7 — Economics

- Usage metering
- Cost events
- Limits
- Alerts
- Billing foundation

### Phase 8 — Hardening

- Security
- Observability
- Failure handling
- Performance
- End-to-end testing

## Task format

Every Claude task should state:

### Objective
Exactly what to implement.

### Context
Relevant specification files.

### In scope
Exact features.

### Out of scope
What must not be touched.

### Acceptance criteria
How success is determined.

### Tests
What must be tested.

### Constraints
Architecture, security, cost, provider abstraction.

## Never do

Do not give Claude:

> "Build the entire AI platform."

Instead give small tasks such as:

> "Implement organization creation, user membership, roles, authorization, tenant isolation, migrations, APIs and tests. Do not implement agents, RAG, voice, billing or integrations."

## Review loop

After Claude completes a task:

1. Run tests.
2. Inspect changes.
3. **Architecture conformance check:**
   - Every new organization-owned table has RLS enabled **and** forced.
   - Every new non-public route declares a required permission.
   - No provider SDK was added ahead of its phase.
   - No infrastructure was added outside `12_ARCHITECTURE_DECISIONS_FINAL.md` §A4.
   - No accepted ADR was contradicted.
4. Ask an independent AI to review where useful.
5. Fix issues.
6. Accept the task.
7. Move to the next task.
