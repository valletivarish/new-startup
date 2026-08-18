# Provider and Cost Specification v0.1

## 1. Purpose

Define how external infrastructure providers are evaluated and integrated without making any provider a permanent product dependency.

## 2. Provider categories

Required categories:

- Telephony
- STT
- TTS
- LLM
- Embeddings
- Vector storage
- Calendar
- ATS/CRM
- Notifications

## 3. Evaluation criteria

Every provider should be evaluated on:

1. Quality
2. Cost
3. Latency
4. Reliability
5. India availability
6. Indian language support
7. Streaming support
8. API quality
9. Rate limits
10. Concurrency
11. Compliance requirements
12. Data handling
13. Developer experience
14. Fallback compatibility

## 4. Telephony

Candidate providers may include:

- Plivo
- Twilio
- Exotel
- Knowlarity
- Other India-capable providers

Do not permanently select a provider based only on headline pricing.

Validate:

- Indian number availability
- Outbound calling
- Inbound calling if required
- Caller ID
- Regulatory requirements
- DLT/DND implications
- Streaming/media support
- Call recording
- Concurrency
- Reliability
- Actual commercial pricing

## 5. STT

Candidate providers:

- Sarvam
- Deepgram
- Other suitable providers

Priorities for India:

- Indian languages
- Code mixing
- Streaming
- Accuracy
- Latency
- Cost

## 6. TTS

Candidate providers:

- Sarvam
- ElevenLabs
- Other providers

Priorities:

- Naturalness
- Indian language quality
- Streaming
- Latency
- Cost
- Voice availability

## 7. LLM

Candidate providers:

- Anthropic
- OpenAI
- Google
- xAI
- Sarvam
- Other suitable models

Do not make application business logic depend on one provider's API schema.

## 8. Customer-facing abstraction

Customer UI should expose:

- Intelligence level
- Voice quality
- Language
- Calling capacity

Provider names should not be required for normal configuration.

## 9. Routing

Future routing factors:

- Cost
- Quality
- Latency
- Language
- Availability
- Task type
- Organization policy
- Data sensitivity

MVP may use explicit internal configuration and basic fallback.

## 10. Cost events

Every provider operation should produce a normalized usage/cost event.

Normalized fields:

- organization_id
- agent_id
- conversation_id/call_id
- provider
- service_type
- quantity
- unit
- provider_cost
- currency
- timestamp

## 11. Cost calculation

Call cost conceptually:

Telephony
+ STT
+ TTS
+ LLM
+ retrieval/embedding
+ infrastructure allocation
= internal cost

Exact infrastructure allocation can initially be approximate and improved later.

Concrete infrastructure figure (ADR-006): approximately **₹2,000–4,500/month through Phases 1–4** — one Indian-region VPS running the Docker Compose stack, plus Cloudflare R2. Managed PostgreSQL (~₹1,200–2,500/month) and Redis are added from Phase 5.

## 12. Budget controls

Required:

- Development call limits
- Maximum call duration
- Daily call limit
- Agent limits
- Organization limits
- Spending alerts
- Emergency stop

Enforcement points (ADR-006, `07_CODING_RULES` §15):

- **Concurrency and spend caps are checked before call origination**, not after. A call that would exceed a limit is never placed.
- Maximum call duration is enforced by a **server-side timer that terminates the call**, independent of provider behaviour.
- Daily call and spend caps apply per organization and platform-wide.
- A **platform-wide kill switch** can stop all outbound calling immediately.
- Every provider operation emits a usage event and a cost event per §10.

## 13. Pricing strategy

Customer pricing should be organization-based.

Potential commercial dimensions:

- Number of agents
- Included usage
- Intelligence tier
- Voice tier
- Knowledge capacity
- Integrations
- Advanced capabilities

Exact prices must be determined after real provider testing and unit economics.

## 14. Bootstrap rule

Target development/testing infrastructure expenditure:

Approximately ₹10,000/month.

Customer usage must not be assumed to be subsidized indefinitely by the founder.

### Indian-region requirement

Compute must run in an Indian region. This constrains hosting and provider selection jointly and is not a cost preference.

The conversational latency budget is roughly 700–1700 ms end-to-end before geography. Hosting compute outside India adds approximately **150–250 ms of round trip on the telephony leg, paid on every conversational turn**. Target: under ~1.2s from end of candidate speech to first returned audio byte, p50.

Providers must therefore be evaluated for Indian availability and Indian PoP latency, not headline price alone.

### Provider selection status

**No telephony, STT, TTS, LLM, or embedding provider has been selected.** All named candidates remain behind adapters. Selection happens at each provider's implementation phase, on benchmark evidence gathered per §16 — never from vendor marketing or headline pricing.

The hosting vendor is likewise **not selected**; ADR-006 approves the architecture (Indian region, always-on container, persistent WebSocket, no serverless on the voice path) and leaves vendor and cost as an open experimental decision. See `12_ARCHITECTURE_DECISIONS_FINAL.md` §D.

## 15. Provider switching requirement

Replacing one provider must not require rewriting:

- Agent definitions
- Workflows
- Dashboard
- Organization model
- Candidate model
- Business logic

Only the provider adapter/routing layer should normally change.

## 16. Benchmarking

Before production provider selection, run representative tests:

### Voice

- Short question
- Long answer
- Interruptions
- Background noise
- Indian accents
- Code mixing

### LLM

- Simple question
- Complex reasoning
- Knowledge-grounded answer
- Tool call
- Refusal/fallback

### End-to-end

- Call latency
- STT latency
- LLM latency
- TTS latency
- Total response latency
- Failure rate
- Cost per minute
- Cost per completed screening

Store benchmark results rather than making decisions from vendor marketing claims.
