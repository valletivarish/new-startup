# Phase 4 Completion Report — Intelligence + Tool Foundation

**Status:** complete
**Tests:** 394 passing, 19 suites, real PostgreSQL via Testcontainers
**Lint:** clean · **Typecheck:** clean · **Clean migration:** verified (0000–0012 applied by the migrator role from an empty database on every test run)
**Provider SDKs installed:** none

---

## 1. Intelligence architecture

The Phase 2 runtime loop is unchanged. What changed is who it delegates to.

```
Inbound event
  → validate, append, settle idempotency        (Phase 2, untouched)
  → load session + PINNED agent version          (Phase 2, untouched)
  → guardrails  · turn ceiling · operator rules  ← application authority
  → knowledge retrieval, outcome preserved       (Phase 3)
  → [defer] intelligence loop                    ← NEW
        assemble context (trust-labelled, bounded)
        call provider (bounded retries)
        model asks for tools → AUTHORIZE each one independently
                             → execute → feed results back as fenced data
        model produces text  → typed outcome
  → outbound events
```

The governing constraint is structural, not stylistic: **the model is the last
participant consulted, never the first.** Every deterministic check runs before
it and none of them can be overridden by anything it returns.

To make that visible in the type system rather than implied by ordering, the
`ExecutionStrategy` seam gained one outcome:

```ts
type RuntimeDecision =
  | { kind: 'reply'; content: string }
  | { kind: 'escalate'; reason: string }
  | { kind: 'end'; reason: string }
  | { kind: 'defer' };          // no deterministic decision applies
```

`defer` is where application authority ends and generation begins. With no
intelligence layer wired, `defer` collapses back to the Phase 2/3
acknowledgement, so earlier behaviour is preserved exactly.

**Files:** `packages/providers/src/intelligence.ts`,
`apps/api/src/intelligence/{orchestrator,context-builder,structured-output,deterministic-provider}.ts`,
`apps/api/src/agents/runtime.ts`.

---

## 2. LLM abstraction

`IntelligenceProvider` is a normalized internal contract, deliberately shaped
after nothing any vendor ships:

```ts
interface IntelligenceProvider {
  name: string;
  modelFor(tier: 'standard' | 'advanced' | 'premium'): string;
  complete(request: NormalizedLLMRequest): Promise<NormalizedLLMResponse>;
  stream(request: NormalizedLLMRequest): AsyncIterable<LLMStreamEvent>;
}
```

Covered: text generation, streaming, structured output, tool calling, usage
metadata, model identification, finish reason, correlation id, and a typed
`ProviderFailure` the runtime can branch on.

**Tiers, not models.** A dashboard user configures `standard` / `advanced` /
`premium`. Which model serves a tier is a platform decision resolved by
`modelFor`, so the business configuration survives changing providers. No
configuration field anywhere names a vendor, model, or endpoint.

**Streaming cannot bypass anything**, because `stream` terminates in the same
`NormalizedLLMResponse` that `complete` returns and that everything else
validates. Asserted directly: the concatenated deltas equal the final
response's content.

**Deterministic provider** (`deterministic-provider.ts`) implements the real
interface, scenario-driven by markers in its input:

| Marker | Scenario |
|---|---|
| *(none)* | ordinary response |
| *(knowledge present)* | grounded response quoting the retrieved text |
| `[[tool:name:{json}]]` | tool request |
| `[[multitool]]` | four tool calls in one response |
| `[[badcall]]` | structurally invalid tool call |
| `[[malformed]]` | structured output that fails its schema |
| `[[fail]]` / `[[timeout]]` | retryable provider failures |
| `[[empty]]` | empty response |
| `[[refuse]]` | refusal |
| `[[loop]]` | never stops requesting tools |

No paid API call, no network, no flakiness. A phase-boundary test asserts the
whole `apps/api/src/intelligence` directory contains no `fetch(`, no URL, and
no `require(` — the moment this reaches the network it stops being a test
double and starts being an unselected vendor integration.

---

## 3. Context assembly

`assembleContext` produces trust-labelled messages:

| Trust | Source | Fenced? |
|---|---|---|
| `platform` | platform-authored policy | no — it *is* the authority |
| `agent` | organization-authored instructions | no |
| `knowledge` | retrieved documents | **yes** |
| `user` | end-user input | **yes** |
| `tool` | tool output | **yes** |

Untrusted content is wrapped in `<<<UNTRUSTED_DATA … END_UNTRUSTED_DATA>>>`,
and the platform policy — first, and not editable by any organization —
states that fenced content is data and never an instruction. A forged closing
marker inside the content is neutralised before wrapping, so the classic
"end the fence early and speak as the system" escape does not work.

Explicit boundaries:

- **History is bounded** by `maxHistoryMessages` (newest kept) and the
  assembled total is checked against `maxContextChars`. Over the limit, the
  turn is refused with a named limit rather than silently trimmed — quietly
  changing what the model sees is worse than declining.
- **Tool output is clamped** to `maxToolOutputChars` with an explicit
  `[output truncated]` marker.
- **No authorization information ever enters the prompt.** A test iterates the
  entire 54-permission catalogue and asserts that not one string appears in
  any assembled message, along with `required_permission`, `organization_id`,
  `grantedPermissions`, and `row-level security`. The model cannot reason
  about, argue with, or describe to a prober a boundary it cannot see.
- **No secrets, credentials, connection strings, or foreign-tenant identifiers**
  are assembled in — there is no code path that could add one.

---

## 4. Knowledge integration

Retrieval runs before the decision, scoped to the agent's **own** attached
sources. The four outcomes stay distinct all the way through; `failed` is never
converted into "no knowledge".

| Outcome | Behaviour |
|---|---|
| `failed` | Deterministic fallback, before the model: *"I cannot reach my knowledge sources right now."* |
| `no_knowledge` / `below_threshold` | The intelligence layer still runs. A final answer backed by neither knowledge nor a tool result is refused. |
| `ok` | Grounded answer, with citations. |

### A defect found by running the platform, not the suite

`refuseWhenNoKnowledge` previously gated the **turn**. Once tools existed this
became a real functional defect: *any* agent with a knowledge source attached
refused every turn that did not retrieve well — including turns that asked for
a tool. Tools became unreachable the moment knowledge was attached. All 387
tests passed while this was true; the live end-to-end run surfaced it in one
pass.

The guardrail's actual purpose is to stop the agent inventing organization
facts, so it now gates the **answer**. A tool result counts as grounding, since
it is not a claim about organization knowledge. The Phase 3 regression fix is
preserved: the guardrail applies only when the agent actually has knowledge
configured. Regression tests: `test/grounding.test.ts`.

---

## 5. Tool architecture

Three tables (migrations `0011`, `0012`):

| Table | Purpose |
|---|---|
| `tools` | Per-organization catalogue: name, description, input/output JSON Schema, `required_permission`, `enabled`, `version` |
| `agent_tools` | Which agents may call which tools |
| `tool_executions` | Every attempt — authorized **and denied**. Append-only. |

**A database row cannot create behaviour.** A `tools` row is a *declaration*.
The code that runs lives in `builtin-tools.ts`, keyed by name. A row naming
something with no implementation is refused. Someone who can write a catalogue
row — or a model that simply invents a tool name — still cannot make the
platform do anything it does not already know how to do.

**The stored JSON Schema is not the validator.** It describes the tool for the
catalogue UI and for the model. Validation uses the Zod schema in code, because
the row is organization-editable data and therefore untrusted for that purpose.

Built-in tools, all deterministic, no network, no credentials:

| Tool | Declares | Notes |
|---|---|---|
| `calculator` | `agents.test` | Structured operation + operands — **not** an expression evaluator, so there is no parser to feed model-authored text to |
| `test_echo` | `agents.test` | Round-trips a message-sized payload |
| `test_structured_output` | `agents.test` | Bounded structured result |
| `deterministic_business_action` | `workflows.run` | Requires a *higher* permission on purpose — this is the tool that proves an agent cannot exceed the acting membership |

No CRM, ATS, calendar, email, SMS, or WhatsApp connection exists.

Events flow into the existing Phase 2 taxonomy unchanged:
`ToolRequested → ToolCompleted | ToolFailed`.

---

## 6. Authorization

**The model requesting a tool does not authorize the tool.** Five independent
conditions, all server-side state, all checked on every call:

1. the tool exists in this organization's catalogue (RLS-scoped);
2. a registered implementation exists for that name;
3. the tool is enabled;
4. the tool is granted to this agent;
5. the acting membership holds the tool's declared permission.

`authorizeTool` is a **pure function** with no parameter the model can
influence — deliberately no field for the tool's arguments, because what a tool
is allowed to do must not depend on what it was asked to do. Each denial reason
is asserted individually.

The permissions come from the database, resolved inside the runtime from the
membership, not passed in by a caller. Input is then validated against the code
schema; output against its own schema before it goes anywhere.

**Phase 4 added no permissions.** The catalogue stays at 54. A tool declares
one from the existing matrix; catalogue management reuses
`agents.read` / `agents.update`; execution records read under
`agents.sessions.read`.

A denied attempt is recorded as carefully as a successful one — it is the
evidence that authorization did its job, and the signal if something keeps
trying.

---

## 7. Runtime safety limits

Enforced by counters in application code. The model is never asked to stop
itself.

| Limit | Default | Env override |
|---|---|---|
| Tool calls per turn | 3 | `RUNTIME_MAX_TOOL_CALLS_PER_TURN` |
| Model↔tool iterations | 3 | `RUNTIME_MAX_TOOL_ITERATIONS` |
| Provider retries | 2 | `RUNTIME_MAX_RETRIES` |
| Context characters | 60 000 | `RUNTIME_MAX_CONTEXT_CHARS` |
| Tool output characters | 8 000 | `RUNTIME_MAX_TOOL_OUTPUT_CHARS` |
| Turn duration | 30 s | `RUNTIME_MAX_DURATION_MS` |
| History messages | 40 | `RUNTIME_MAX_HISTORY_MESSAGES` |
| Turns per session | 50 | agent configuration (`maxTurns`) |
| Single tool call | 5 s | executor constant |

An agent's configuration may **narrow** a limit; it can never widen one
(`Math.min` against the platform ceiling). Environment-tunable because a limit
nobody can adjust tends to get removed rather than lowered.

Exceeding a limit terminates safely: an `ErrorOccurred` event naming the limit,
an `agent.limit.exceeded` audit entry, an optional escalation, and no further
provider calls. **Retries happen only for faults the provider marked
retryable** — never for a refusal, a validation failure, or a malformed
response, because repeating an identical request that produced bad output is
how a bounded loop becomes an unbounded bill.

---

## 8. Structured outputs

Model output is treated as untrusted input:

- size-bounded before parsing (100 000 characters);
- a fenced code block is unwrapped, but malformed JSON is **never repaired** —
  recovering from a known wrapper is fine, guessing at content is not;
- validated with `safeParse`, never `parse`, so a schema mismatch is a typed
  `ValidationFailure` and not an exception that a generic handler would report
  as a platform fault;
- unknown keys are rejected rather than dropped.

The same discipline applies to **structure**, not just content: every tool call
is validated (`callId` present, `name` matching `^[a-z][a-z0-9_]*$`, bounded
length) before the registry is even queried. A tool named `../../etc/passwd`
never reaches authorization. One malformed call fails the whole batch —
partially acting on output already found untrustworthy is the worst of both
readings.

---

## 9. Security

**Never sent to the model:** API credentials, database credentials, internal
authorization tokens, permission sets, role names, organization identifiers,
or any organization data beyond the retrieved chunks the agent's own sources
returned.

**The model has no access to:** database, filesystem, network, shell, or
arbitrary APIs. Its only side-effecting channel is a tool request, and that
request is re-decided by `authorizeTool` before anything happens.

**Chain-of-thought is not stored.** Audit entries carry operational metadata
only — counts, timings, model, provider, token totals. Conversation content
lives in the event stream, readable under `agents.sessions.read`, which the
matrix already treats as sensitive; duplicating it into the audit trail would
widen who can read a conversation.

### Prompt injection

The architectural answer is that authorization lives outside the model.
Fencing is defence in depth, not the defence.

The adversarial tests make the strong assumption: **the deterministic provider
deliberately obeys instructions found in retrieved documents and tool output.**
A test in which the model politely ignores an injected instruction proves
nothing about the platform. Assuming the model is fully subverted is the only
way to test that the platform still refuses.

| Attack | Result |
|---|---|
| Instruction inside **tool output** | Model obeys, requests the business action, **denied** (`not_granted_to_agent`) |
| Instruction inside a **retrieved document** | Same — and the turn still ends in an ordinary response |
| Forged fence terminator in user input | Neutralised before wrapping |
| Invented tool name | `unknown_tool` |
| Path-shaped tool name | Rejected at structural validation, never recorded |
| `__proto__` / operator-shaped arguments | Rejected by the tool's own schema |

---

## 10. Tenant isolation

Unchanged three-layer rule: permission check → explicit `organization_id`
filter → `ENABLE` **and** `FORCE ROW LEVEL SECURITY`. All three new tables
carry it, verified by the schema-drift test that scans every table with an
`organization_id` column.

`test/tool-isolation.test.ts` (13 tests) covers both layers:

- a foreign tool id is a **404**, never another tenant's data — for
  enable/disable, granting, and listing an agent's tools;
- B's tool executions for A's session return `[]`;
- B's tenant context selects nothing from A's `tools`, `agent_tools`, or
  `tool_executions`;
- B cannot insert a tool into A's organization, grant one of A's tools, or
  forge an execution record for another organization — all refused by RLS
  (PostgreSQL `42501`, verified through the cause chain, not the wrapper
  message);
- `tool_executions` is append-only even for the runtime role: `UPDATE` and
  `DELETE` are revoked.

Retrieval context is built entirely from the validated session. A tool from
organization B disabled by B has no effect on A — asserted directly.

---

## 11. Audit and observability

Audit events (metadata only, no content, no reasoning):

| Event | When |
|---|---|
| `agent.response.generated` | every intelligence turn — outcome, provider calls, tokens, duration, model |
| `agent.knowledge.used` | retrieval returned usable chunks |
| `agent.tool.completed` / `agent.tool.failed` / `agent.tool.denied` | per tool attempt, with the denial reason |
| `agent.provider.failed` | provider failure kind and retryability |
| `agent.output.validation.failed` | model output rejected |
| `agent.limit.exceeded` | which limit stopped the turn |
| `tools.installed`, `tool.enabled`, `tool.disabled`, `agent.tool_granted`, `agent.tool_revoked` | catalogue changes |

Observability: one structured log line per turn (`agent.turn.completed`)
carrying outcome, provider-call count, total tokens, duration, model, provider,
retrieval outcome, and tools offered. No secrets, no PII.

Usage metadata is normalized on every response — input/output/total tokens,
model, provider, latency, request id — and collected per provider call for the
future cost layer. No billing is built.

---

## 12. Tests — 394 passing, 19 suites

| Suite | Tests | Covers |
|---|---|---|
| `intelligence.test.ts` | 39 | context assembly, fencing, history bounds, provider scenarios, structured output, authorizer truth table, built-in tool schemas, retry policy, usage metadata |
| `intelligence-adversarial.test.ts` | 16 | unauthorized/unknown/disabled/cross-org tools, malicious arguments, tool-output and document injection, oversized output, runaway loop, malformed output, provider failure, timeout, empty response, refusal, escalation |
| `tools.test.ts` | 11 | catalogue install/idempotency, grants, permission gating, denial recording, audit entries |
| `tool-isolation.test.ts` | 13 | API 404s, RLS refusals, append-only executions |
| `grounding.test.ts` | 7 | the `refuseWhenNoKnowledge` correction and pre-check ordering |
| `agent-runtime.test.ts` | 11 | event ordering, idempotency, guardrails, turn ceiling (updated for the intelligence path) |
| `phase-boundary.test.ts` | 11 | no provider SDK anywhere, no later-phase tables, no I/O in the intelligence layer |
| `route-coverage.test.ts` | 112 | every route declares exactly one authorization marker |
| *(Phase 1–3 suites)* | 174 | unchanged and passing |

Every database test runs against real PostgreSQL 16 + pgvector via
Testcontainers, migrated from empty by the **migrator** role — the privilege
split is exercised, not assumed. No RLS test uses a mock.

Retry counts and provider-call counts are asserted exactly, not approximately.

---

## 13. Live verification

Full end-to-end run against the local stack (real Postgres on 5434, API booted
from `src/main.ts`, HTTP through `curl`, session cookies only). Transcript:
`PHASE_4_LIVE_RUN.txt`.

```
 4. install built-in tools
      calculator                    -> agents.test     enabled
      deterministic_business_action -> workflows.run   enabled
      test_echo                     -> agents.test     enabled
      test_structured_output        -> agents.test     enabled
 5. grant ONLY test_echo to the agent

 8. grounded answer
      AgentResponseGenerated — Based on the approved knowledge: [leave.md …]
                               eighteen days of paid annual leave
                               [grounded in: leave.md]

 9. authorized tool call
      ToolRequested — test_echo → ToolCompleted → AgentResponseGenerated

10. unauthorized tool (installed org-wide, not granted to this agent)
      ToolRequested → ToolFailed — This agent is not allowed to use that tool.

11. prompt injection through tool output
      ToolRequested test_echo → ToolCompleted
      ToolRequested deterministic_business_action → ToolFailed (denied)

12. runaway tool loop
      3 × (ToolRequested → ToolCompleted)
      ErrorOccurred — stopped after reaching a safety limit (max_tool_iterations)

13. provider outage
      ErrorOccurred — The assistant is temporarily unavailable.

14. execution records
      test_echo                      completed  -
      deterministic_business_action  denied     not_granted_to_agent
      …

15. audit trail
      agent.knowledge.used 1 · agent.limit.exceeded 1 · agent.provider.failed 1
      agent.response.generated 6 · agent.tool.completed 5 · agent.tool.denied 2
```

This run is what surfaced the `refuseWhenNoKnowledge` defect described in §4.
It was re-run after the fix; the transcript above is the corrected run.

---

## 14. Known limitations

1. **The deterministic provider is not a model.** It reacts to markers, not to
   meaning. It proves the orchestration, the limits, and the authorization —
   it proves nothing about answer quality, and does not pretend to.
2. **Structured output is not yet used by the runtime loop.** The validation
   layer is complete and tested, and tool-call structure is validated on every
   turn, but no agent configuration currently requests a response schema.
3. **Streaming is contract-only.** `stream` exists, is tested, and terminates
   in the same validated response — but the HTTP surface still returns a turn
   at a time. Incremental delivery arrives with the voice transport.
4. **Retries are single-provider.** Bounded retry against the same provider is
   implemented; failover to a second provider is not. The interface supports it
   without changing agent definitions.
5. **Context trimming is coarse.** History is bounded by message count; an
   over-limit context refuses the turn rather than dropping knowledge. Both are
   deliberate — silent trimming changes what the model sees without anyone
   knowing — but a smarter budget-aware assembler is future work.
6. **Tool output is clamped by characters, not tokens.** Correct once a
   tokenizer exists; today a character bound is honest and provider-neutral.
7. **`test_echo` accepts a full message-sized payload** so the output clamp is
   exercised by something real. A production catalogue would size each tool to
   its purpose.
8. **No per-organization rate limiting on provider calls.** The per-turn limits
   bound a single conversation; nothing yet bounds an organization's aggregate
   spend. That belongs with the usage/cost layer.

---

## 15. Deferred provider decisions

No production intelligence provider has been selected, and the ADR-006
condition still holds: selection happens on benchmark evidence at its phase,
not by default through an import.

Still deferred, verified by the phase-boundary test against every package and
the lockfile:

- OpenAI, Anthropic, Google, xAI, Sarvam
- ElevenLabs, Deepgram, and every other speech provider
- Twilio, Plivo, Exotel
- LangChain, LlamaIndex, Vercel AI SDK and every other orchestration framework
- CRM, ATS, calendar, email, WhatsApp, SMS

`packages/providers` still declares **zero runtime dependencies**. Its one
class is `LLMProviderError` — a typed error the runtime branches on, asserted
by test to be the only one.

Swapping in a real provider is one DI binding in `app.module.ts`:

```ts
{ provide: INTELLIGENCE_PROVIDER, useFactory: () => createDeterministicIntelligenceProvider() }
```

Nothing else changes — not the runtime, not the tool layer, not any agent
configuration, because no configuration names a vendor.

---

## 16. Recommended Phase 5

The architecture's stated purpose for Phase 5 is the **Voice Gateway**, and
ADR-007 exists precisely so that it can arrive without reshaping the runtime.
The entry check from `12_ARCHITECTURE_DECISIONS_FINAL` still applies: voice
must be addable by adding event *types*, not by changing the session model, the
ordering guarantee, or the runtime loop.

Two things are worth settling first, and both are small:

1. **Select the intelligence provider on evidence.** The abstraction is now
   proven end to end against a fake. Benchmarking two or three candidates for
   Indian-language screening quality and latency — and writing the ADR — is the
   natural next decision, and it unblocks any real quality assessment. It is
   also cheap to do now and expensive to do after voice, when latency budgets
   are entangled.
2. **Bound cost per organization.** Per-turn limits exist; aggregate limits do
   not. On a ₹10,000/month budget, one runaway integration is the difference
   between a bill and a problem.

Then Phase 5 proper: `VoicePipeline` implementation, telephony provider
selection, and the streaming transport — consuming the same
`AgentSession` contract, the same authorization layer, and the same limits
built here.

**Phase 5 has not been started.**
