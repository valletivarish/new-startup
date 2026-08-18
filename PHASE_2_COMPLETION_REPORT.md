# Phase 2 Completion Report — Agent Foundation

**Date:** 2026-08-18
**Status:** COMPLETE against the Phase 2 completion criteria
**Verification:** 219 tests passing against real PostgreSQL; lint clean; typecheck clean in all five packages; clean-database migration verified; agent lifecycle and runtime verified live end to end.

---

## 1. Features implemented

| Area | What exists |
|---|---|
| Agent model | Organization-scoped `Agent` with identity, purpose, type, lifecycle status and a pointer to the serving version |
| Versioning | `AgentVersion` with monotonic numbering, one open draft and one published version per agent, both enforced by partial unique indexes |
| Configuration | Versioned Zod contract covering identity, purpose, conversation, capabilities, knowledge references, rules, guardrails, tool references, escalation, follow-up and evaluation — `.strict()` throughout, so a typo is rejected rather than silently dropped |
| Lifecycle | `draft → published → paused → archived` as an explicit allow-list; `archived` is terminal; invalid transitions are 409 |
| Immutability | A published version cannot be edited — enforced by a **database trigger**, not only by the service |
| Sessions | `AgentSession` pinning the exact `agent_version_id` at creation; a later publish cannot change a live conversation |
| Events | Generic taxonomy (10 types), per-session monotonic `sequence`, direction, payload, correlation and idempotency |
| Ordering | Sequence allocated by incrementing a session counter under a row lock, with a unique index as backstop |
| Idempotency | Client key unique per session; a retry returns the original event and produces **no** new outbound events |
| Runtime | Deterministic orchestration skeleton: validate → load session → load pinned version → load state → apply rules → emit outbound events |
| Contracts | `AgentRuntime`, `ExecutionStrategy`, `AgentContext`, `ConversationState`, `MemoryProvider`, `ToolRegistry`, `ToolExecutor`, `ToolDefinition` — interfaces only |
| UI | Agents list, creation, detail, version list, draft editing, publish/pause/archive, session and event inspection |
| Audit | `agent.created`, `agent.updated`, `agent.version.created`, `agent.version.published`, `agent.paused`, `agent.archived`, `agent.session.started`, `agent.session.ended` |

## 2. Files changed

**New:** `packages/db/src/schema/agents.ts`; `apps/api/src/agents/{configuration,events,lifecycle,agents.service,sessions.service,runtime,agents.controller}.ts`; `packages/providers/src/runtime.ts`; migrations `0006`–`0008`; tests `agents.test.ts`, `agent-runtime.test.ts`, `agent-isolation.test.ts`, `setup/agent-fixtures.ts`; web `app/agents/page.tsx`, `app/agents/[id]/page.tsx`.

**Modified:** permission catalogue and role bundles; `packages/db/src/schema/index.ts`; `apps/api/src/{app.module,tokens.more}.ts`; `test/{route-coverage,phase-boundary,schema-drift}.test.ts`; web `lib/api.ts` and dashboard; seed generator (now accepts an output filename).

## 3. Database changes

Four tables — `agents`, `agent_versions`, `agent_sessions`, `agent_events` — all organization-owned with **RLS enabled and forced**, `USING` and `WITH CHECK` on `current_org_id()`.

Constraints doing real work rather than application assumptions:

- one open **draft** per agent, and one **published** version per agent (partial unique indexes) — this is what makes concurrent publishing safe
- unique `(session_id, sequence)` — ordering is a database guarantee
- unique `(session_id, idempotency_key)` — a retry cannot fork a conversation
- unique agent name per organization **among non-archived agents**, so archiving frees the name
- `agent_events` is **append-only**: `UPDATE`/`DELETE` revoked from the runtime role
- trigger `agent_versions_immutable_when_published` refuses any configuration or identity change to a published version

Clean-database result: 15 tables, 8 RLS-forced, 14 policies, 54 permissions, 182 grants, `platform_app` still with no CREATE and no BYPASSRLS.

## 4. API endpoints

`GET/POST /agents` · `GET/PATCH /agents/:id` · `POST /agents/:id/{publish,pause,archive}` · `GET /agents/:id/versions` · `GET /agents/:id/versions/:versionId` · `POST /agents/:id/versions` · `PATCH /agents/:id/versions/:versionId` · `POST /agents/:id/versions/:versionId/publish` · `POST/GET /sessions` · `GET/DELETE /sessions/:id` · `GET /sessions/:id/events` · `POST /sessions/:id/events` (runtime ingest).

Every route declares exactly one permission; the guard fails closed without one and the route-coverage test fails the build. A foreign id returns 404, never 403.

## 5. Runtime architecture

```
Inbound event → validate (type + payload schema)
              → append with sequence + idempotency
              → [duplicate? return original, do NOT reprocess]
              → load session and PINNED version configuration
              → load conversation state (turn count, last message)
              → ExecutionStrategy.decide()
              → persist outbound events
```

The runtime never reads an agent's *current* configuration — only the version the session pinned. `ExecutionStrategy` is the single seam where Phase 4's LLM replaces the deterministic strategy; the loop, the event taxonomy and the session model do not change. Guardrails outrank rules, and the turn ceiling ends the session.

## 6. Permission changes

54 permissions (was 51). Three added, each justified; the rest reuse what exists:

| Added | Why |
|---|---|
| `agents.archive` | Terminal lifecycle action; `delete` implies removal, archiving retains |
| `agents.sessions.read` | Session events carry conversation content — gated like transcripts, and marked **sensitive** so every read is audited |
| `agents.sessions.manage` | Creating, driving and ending sessions is operational authority, distinct from reading |

Deliberately **not** added: publish (that is `agents.deploy`), version creation (`agents.update`), version listing (`agents.read`). Role model preserved: Agent Manager 25→28, Recruiter 22→24; Analyst and Viewer gained nothing, so they still cannot read conversation content.

## 7. Tests — 219 passing, 12 suites, 0 skipped

New: `agents.test.ts` (14) — CRUD, invalid and unknown-key configuration, immutability at both service and database layer, one-draft rule, supersession, lifecycle transitions, terminal archive, concurrent publish. `agent-runtime.test.ts` (11) — event ordering, rules, guardrail precedence, turn ceiling, ended-session refusal, forged runtime event, concurrent ingestion producing a gapless sequence, deduplication, simultaneous duplicate keys. `agent-isolation.test.ts` (16) — cross-tenant read/write/insert/delete/session/event/version access, row migration, permission enforcement, sensitive-access auditing, audit coverage.

`route-coverage` grew from 34 to 70 assertions as the new routes came under the same guard.

## 8. Security verification

- Tenant context still comes only from the server-side session; no agent endpoint accepts an organization id.
- Cross-tenant probes on agents, versions, sessions and events all return **404**, and the agent list never contains another tenant's rows.
- At the database layer: zero rows without tenant context, insert-attribution refused, row migration to another tenant refused, update/delete of another tenant's agents affect 0 rows.
- Published versions are immutable even against a **direct superuser UPDATE** — the trigger, not the service, is what refuses it.
- The event log cannot be rewritten by the runtime role.
- An Analyst is refused session events; a Viewer cannot create, publish, archive or drive sessions.
- No Phase 1 guarantee was weakened: `platform_app` still holds no CREATE anywhere and no BYPASSRLS.

## 9. Tenant-isolation verification

All four new tables carry ENABLE + FORCE RLS with matching `WITH CHECK`, verified on a clean database and asserted by the schema-drift test, which now covers them automatically because they carry `organization_id`.

## 10. Known limitations

1. **The runtime is deliberately deterministic.** Responses come from configured rules, not intelligence. This is the phase boundary, not an oversight.
2. **Tools are contract-only.** `ToolRegistry`/`ToolExecutor` are defined; nothing executes, and no `ToolRequested` event is emitted yet.
3. **Memory is conversation state only.** Business memory and organization knowledge are interfaces awaiting Phase 3/6.
4. **Sessions and versions are unpaginated** (capped at 200). The cursor helper from Phase 1 exists and should be applied when volumes justify it.
5. **Draft editing in the UI is raw JSON.** The guided wizard from `05_UX_DASHBOARD_SPEC` §7 belongs with the capabilities it configures.
6. **`businessContext` is untyped by design** — typing it would import recruitment vocabulary into the generic runtime.

## 11. Deferred functionality

LLM, STT, TTS, telephony, RAG, embeddings, document processing, recruitment, candidates, jobs, calendar, CRM/ATS, billing, usage metering. No provider SDK was added — verified across every manifest and the lockfile. No Phase 3+ table exists; the boundary test now guards the Phase 3 line.

## 12. Recommended next phase

**Phase 3 — Knowledge / RAG**, as the approved sequence has it. The agent configuration already carries `knowledge[]` references and a `refuseWhenNoKnowledge` guardrail with nothing behind them, so Phase 3 has a defined contract to satisfy: `KnowledgeSource`/`Document`/`Chunk` with pgvector, document processing on the existing pg-boss worker, and retrieval behind the `KnowledgeStore` interface — organization-scoped, with the vector tenant-isolation test from Phase 1 finally pointed at a real table.

One Phase 2 item worth folding in: emit `ToolRequested` events once the tool layer exists, so the taxonomy is exercised rather than merely declared.
