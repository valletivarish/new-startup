# Coding Rules for Claude Code

## 1. Role

You are the primary implementation engineer for this project.

The project documents in this folder are the source of truth.

Do not invent product requirements that contradict them.

## 2. Implementation style

Build incrementally.

Never attempt to implement the entire platform from one prompt.

Each task must have:

- Scope
- Explicit files/modules affected
- Acceptance criteria
- Tests
- Validation

## 3. Architecture rules

### Must

- Preserve modular boundaries.
- Preserve tenant isolation.
- Use provider adapters.
- Keep business logic provider-independent.
- Validate authorization server-side.
- Use typed request/response contracts where supported.
- Add tests for important business logic.
- Use migrations for database changes.
- Document non-obvious decisions.
- **Enable and force row-level security on every new organization-owned table, in the same migration that creates it.**
- **Declare a required permission on every non-public route.** Undeclared routes fail closed.
- **Check permission strings, never role names.** `requires('agents.deploy')`, never `role === 'admin'`.
- Keep the agent runtime stream-shaped; never reduce it to request → response (ADR-007).

### Must not

- Hard-code provider SDK calls into business services.
- Add a new database without a documented reason.
- Introduce microservices without a demonstrated need.
- Add Kubernetes just because it is familiar.
- Add Kafka just because the system is event-driven.
- Add unnecessary dependencies.
- Build future features before MVP features.
- Rewrite architecture without approval.
- **Introduce infrastructure not listed in `12_ARCHITECTURE_DECISIONS_FINAL.md` §A4.**
- **Embed any AI or telephony provider.** All remain behind interfaces until selected on benchmark evidence.
- **Delegate authorization to the authentication library.** Better Auth answers identity questions only.

## 4. Tenant security

> **Engineering rule: no cross-tenant data access, even accidentally.**

Every tenant-owned operation must be organization-scoped.

Never trust client-provided organization IDs without authorization checks.

Hard rules from ADR-003:

- **Never set `app.current_org_id` from client-supplied input.** Derive it only from the authenticated server-side session.
- **Background jobs must establish tenant context per organization and per transaction.** Never once per batch.
- Transaction-mode connection pooling with `SET LOCAL` inside an explicit transaction. Session-level `SET` is forbidden.
- The application connects as a non-owner database role. Never run application queries as the table owner.

Test that:

- Organization A cannot access Organization B.
- Organization A cannot modify Organization B.
- Organization A cannot insert rows attributed to Organization B.
- A query with tenant context unset returns zero rows.
- Users cannot exceed their role permissions.
- Users cannot escalate their own role; the last Owner cannot be removed.

## 5. Provider abstraction

Use interfaces/adapters for:

- LLM
- STT
- TTS
- Telephony
- Embeddings
- Calendar
- CRM/ATS
- Notifications

Provider-specific configuration belongs in adapter/configuration layers.

## 6. Secrets

Never commit:

- API keys
- Tokens
- Passwords
- Private credentials
- Production secrets

Use environment variables or a secure secret-management mechanism.

## 7. Logging

Never log:

- API keys
- Authorization tokens
- Sensitive candidate information unnecessarily
- Full credentials

Use structured logging where practical.

## 8. Errors

Return safe, consistent API errors.

Do not expose stack traces or provider secrets to users.

Log internal diagnostic information securely.

## 9. Database

Use migrations.

Do not manually modify production schema outside the migration process.

Add indexes based on actual query patterns.

## 10. API

Maintain backward-compatible API contracts unless the task explicitly requires a breaking change.

Validate all external input.

Use idempotency where duplicate operations could cause harm.

## 11. Webhooks

Webhook processing must be:

- Authenticated
- Validated
- Idempotent
- Organization-aware

## 12. AI behavior

Do not rely on prompts as the only security mechanism.

Tool permissions must be enforced by backend code.

**Agent tool authorization resolves through the same permission layer as human authorization.** An agent cannot perform an action the initiating membership lacks permission for.

Structured outputs must be validated with Zod before being persisted or acted upon.

## 13. Knowledge

Knowledge retrieval must be organization-scoped.

Do not allow cross-tenant retrieval.

Handle failed/empty retrieval safely.

## 14. Testing

For every meaningful feature, add appropriate tests.

At minimum for critical functionality:

- Unit tests
- Integration tests
- Authorization tests
- Tenant-isolation tests

For provider integrations, use mocks/fakes in normal automated tests.

Do not make the test suite depend on paid external calls unless explicitly required.

**Tenant-isolation and RLS tests must run against real PostgreSQL via Testcontainers.** Mocked or in-memory databases cannot verify row-level security, so a green suite against a mock proves nothing about isolation.

Three structural tests are mandatory and must not be removed:

1. **Schema drift** — every table with an `organization_id` column has RLS enabled and forced.
2. **Route coverage** — no non-public route lacks a declared permission.
3. **Permission matrix** — all 51 × 7 role/permission combinations behave exactly as `11_PERMISSION_MATRIX.md` specifies.

## 15. Cost control

Development code must include safeguards against accidental expensive usage.

Do not create unlimited:

- outbound calls
- LLM loops
- retries
- background jobs
- provider requests

## 16. Dependencies

Before adding a dependency:

1. Check whether the existing stack can solve the problem.
2. Check maintenance/quality.
3. Consider runtime cost.
4. Consider security.
5. Explain why it is needed.

## 17. Scope discipline

If a task is:

"Implement organization management"

do not also implement:

- voice
- RAG
- billing
- recruitment
- provider routing

unless explicitly requested.

## 18. Completion report

At the end of every implementation task, report:

1. What was implemented.
2. Files changed.
3. Database migrations added.
4. Dependencies added.
5. Tests added.
6. Tests executed/results.
7. Known limitations.
8. Any architectural decisions that require approval.

## 19. Do not hide failures

If something cannot be implemented correctly, stop and explain:

- What is blocking it.
- Why it is blocking it.
- What decision/input is needed.

Do not silently create a workaround that violates the architecture.

## 20. Source-of-truth hierarchy

When documents conflict, use this priority:

1. Explicit latest user decision
2. **Accepted ADRs (`10_ADRs/`) and `12_ARCHITECTURE_DECISIONS_FINAL.md`**
3. Approved BRD
4. Approved system architecture
5. Approved database/API specification
6. Approved UX specification
7. Provider/cost specification
8. Coding rules
9. Existing implementation

If a conflict materially affects architecture, stop and ask for clarification instead of guessing.

## 21. ADR process

Architectural decisions are recorded as numbered ADRs in `10_ADRs/`.

- ADRs are numbered sequentially and **never edited once ACCEPTED**.
- Changing an accepted decision requires a **new ADR that supersedes** the old one, with both left in place.
- Status transitions: `PROPOSED → ACCEPTED → SUPERSEDED BY ADR-NNN`.
- Any implementation task that would contradict an accepted ADR must stop and request a superseding decision, per §19.

## 22. Stack conventions

- TypeScript with `strict: true`. No implicit `any`.
- Drizzle for all data access; every request runs inside the tenant-context transaction wrapper.
- Zod at every external boundary — HTTP input, webhook payloads, structured LLM output.
- NestJS modules mirror the logical module list in `03_SYSTEM_ARCHITECTURE.md` §2.
- Provider adapters are bound through the DI container, never imported directly by business services.
- Interfaces may be defined ahead of their implementation phase; **provider SDK dependencies may not be added ahead of theirs**.
