# Phase 5 Pre-Implementation — Provider Comparison

Companion to `PHASE_5_PROVIDER_RESEARCH.md`, which holds the sources and labels. This document
compares, tiers, and maps providers onto the abstraction the platform already has.

**Optimisation target, from the brief:** QUALITY × LATENCY × COST × INDIA × REPLACEABILITY.
Not popularity, not price alone, not benchmark scores.

FX for all conversions: **₹95.74/USD** (ESTIMATE — see research §0).

---

## 1. Scoring frame

Each provider is scored on the five factors the brief names. Scores are **judgement calls from the
evidence in the research document**, not measurements — no one has run a benchmark yet, and §16 of
`06_PROVIDER_AND_COST_SPEC` exists precisely because they must be.

Legend: ●●●● strong · ●●● adequate · ●● weak · ● disqualifying · ? unverifiable

---

## 2. TELEPHONY

| Provider | Quality | Latency | Cost | India | Replaceability | Notes |
|---|---|---|---|---|---|---|
| **Plivo (India region)** | ●●● | ●●● | ●●●● ₹0.38/min | ●●●● | ●●● | Only published India rate; bidirectional media free |
| **Exotel** | ●●● | ? | ? sales-gated | ●●●● | ●●● | Mumbai region, UL-VNO/TRAI/DLT claims; ₹9,999 entry floor |
| **Twilio** | ●●●● | ●●● | ● ₹5.17/min | ● no Indian DID, foreign CLI only | ●●●● | Toll-free +91800 inbound is the one usable piece |
| **Telnyx** | ●●● | ●●● | ? unpublished India rate | ●● | ●● | **12-month India minimum commitment** in their ToS |
| **Acefone** | ●●● | ? | ●● ₹9,594/mo floor | ●●●● | ●● | 5–6 seat minimum consumes the whole budget |
| **Vonage** | ? | ●●● | ? | ? | ●●● | Every commercial page 403s |
| Ozonetel / Knowlarity / TeleCMI / MyOperator | ? | ? | ? | ●●● | ? | Unevaluable, or wrong product shape |

**Conclusion.** One viable primary. Plivo is the only provider that publishes an India rate you can
budget against *and* includes bidirectional websocket media at no surcharge. Exotel is the only
credible second source — India-domiciled, genuinely capable of bidirectional streaming, with a real
regulatory posture — but you cannot model it without a written quote.

**This is a single point of failure with no contractual recourse.** Plivo publishes no SLA, no rate
limits, no concurrency ceiling, and offers no free tier to test with. Design the telephony adapter so
switching is a days-not-months job, and get a written Exotel quote before launch so a second source
exists on paper.

---

## 3. SPEECH-TO-TEXT

| Provider | Quality (Indic) | Latency | Cost/min (ESTIMATE) | India | Replaceability |
|---|---|---|---|---|---|
| **Sarvam Saaras v3** | ●●●● 22 Indic, `codemix` mode | ? **none published** | **₹0.50** | ●●●● INR-native | ●●●● |
| **Azure Speech** | ●●●● en-IN + hi-IN + 10 Indic, explicit multilingual | ●●● in-country RTT | ₹1.60 | ●●●● **Central India verified** | ●●●● |
| **Deepgram Nova-3** | ●●● en-IN + hi | ●●● "<300 ms" | ₹0.46 | ●● none stated | ●●●● |
| **Gladia Solaria-1** | ●● Indic not named | ●●●● **103 ms partials** | ₹1.20 | ●● EU posture | ●●● |
| **ElevenLabs Scribe v2 RT** | ●● Hindi only confirmed | ●●●● ~150 ms | ₹0.62 | ●● | ●●● |
| **AssemblyAI** | ●● **no en-IN dialect** | ? | ₹0.24 cheapest | ●● | ●●●● |
| **OpenAI live transcribe** | ? not named | ? | ₹1.63 | ●●● India endpoint | ●●●● |
| **Google Cloud STT** | ●●●● broadest Indic | ? | **? unreadable** | ●●● | ●●●● |
| **AI4Bharat IndicWhisper** | ●●● 12 Indic | ? **no streaming** | ₹0 licence | ●●●● you host | ●●●● |

**Conclusion.** Sarvam wins on cost and Indic breadth and is the only vendor treating Hinglish as a
first-class feature — which is the actual linguistic reality of Indian recruitment calls. Azure wins
on verified India region and is the natural backup. Deepgram is the best non-Indian fallback.

**The unresolved risk:** Sarvam publishes **no latency figure at all**. Everything else about it fits;
this one gap could disqualify it. It is the first thing to benchmark.

---

## 4. TEXT-TO-SPEECH

| Provider | Quality (Indic) | Latency | Cost/min (ESTIMATE) | India | Replaceability |
|---|---|---|---|---|---|
| **Sarvam Bulbul v2** | ●●●● 11 Indic, en-IN first-class | ? **none published** | **₹0.57** | ●●●● INR-native | ●●●● |
| **Cartesia Sonic-3.6** | ●●● Hindi + **demonstrated Hinglish** | ●●●● sub-90 ms | ₹2.81 | ●●●● **India data centres** | ●●● credit model |
| **Smallest.ai Lightning** | ●●●● 10 Indic + auto language routing | ●●●● **~200 ms TTFB documented** | ₹8.62 | ●●● India co., USD billing | ●●● |
| **Azure Neural TTS** | ●●●● 9 hi-IN + 16 en-IN voices | ? | ₹0.55 + **0.5M free chars/mo** | ●●●● Central India | ●●●● |
| **ElevenLabs Flash v2.5** | ●●● Hindi, Hinglish undocumented | ●●●● ~75 ms | ₹1.83 | ● none | ●●●● |
| **Rime Coda** | ●●● Hindi (Coda only) | ●●●● **P50 96 ms / P90 98 ms** | ₹1.83 | ● | ●●● |
| **Google Chirp 3: HD** | ●●●● broadest Indic | ? | ? THIRD_PARTY only | ●●● | ●●●● |
| **Deepgram Aura-2** | ● **no Hindi, no en-IN** | ●●●● sub-200 ms | ₹1.10 | ● | — |

*Per-minute figures assume 850 chars/min of speech at 45% agent talk share — see the economics
document for the derivation.*

**Conclusion.** Sarvam is cheapest and Indic-native; Azure is close on cost with a **recurring 0.5M
free characters per month** and a verified Indian region, which makes it an unusually strong backup
for a bootstrap. Cartesia is the quality-and-latency play with a real India presence. Deepgram Aura
is disqualified outright — no Hindi, no Indian English.

**Note the shape of this layer:** the two cheapest options publish no latency figure, and the two
with the best-documented latency are 3.5–15× the price. That trade is the real decision here, and it
cannot be resolved from documents.

---

## 5. LLM — CONCEPTUAL TIERS

The customer sees **STANDARD / ADVANCED / PREMIUM**. They never see a vendor name. This mapping is
platform configuration, resolved by `IntelligenceProvider.modelFor(tier)`, and changing it is a
one-line change that no agent configuration or customer-visible setting depends on.

### Tier definitions — capability, not vendor

| Tier | What the customer is buying | Where it is used |
|---|---|---|
| **STANDARD** | Reliable turn-taking, follows the script, grounded answers from approved knowledge, calls tools correctly. Optimised for latency and cost. | Default for live screening calls |
| **ADVANCED** | Better judgement on ambiguous answers, multi-step reasoning, sturdier under interruption and code-switching. | Complex roles, senior screening |
| **PREMIUM** | Best available reasoning for post-call evaluation, structured scoring, and edge-case handling. Latency matters less off the call path. | Offline evaluation, difficult conversations |

### Recommended tier mapping

| Tier | Primary | Backup | Blended cost /1M (ESTIMATE, 3:1 in:out) | Why |
|---|---|---|---|---|
| **STANDARD** | **Sarvam 105B** (₹29.28 / ₹73.2) | `gemini-2.5-flash-lite` ($0.10/$0.40 ≈ ₹16.8 blended) | ₹40.3 / $0.175 | INR-billed, Hinglish-native, tools + `json_schema` + SSE. Gemini is 2.4× cheaper but adds FX and residency questions. |
| **ADVANCED** | `gpt-5.6-luna` ($0.20/$1.20) | `gemini-3.7-flash` ($0.75/$3.75) | $0.45 / $1.50 | Luna is exceptional value at a 1.05M context, **and OpenAI is the only frontier lab publishing an India residency endpoint**. |
| **PREMIUM** | `gemini-3.1-pro-preview` ($2/$12) | Claude Sonnet 5 ($2/$10) — *residency-permitting* | $4.50 / $4.00 | Off the call path, so latency is not binding. Sonnet 5's introductory price is now permanent. |

**Deliberately not selected, with reasons:**

- **Groq** — fastest published throughput (1,000 tok/s), but strict schema enforcement is GPT-OSS-only
  **and mutually exclusive with streaming and tool use**. A voice agent needs all three at once.
  Disqualified on architecture, not price.
- **DeepSeek** — best *verified* strict tool calling in the entire survey, and cheap. Blocked on
  cross-border PII: it is China-based, and candidate transcripts are personal data under DPDP.
  Revisit only with a completed transfer analysis.
- **xAI Grok** — cleanest strict-output guarantee, 6–25× too expensive here.
- **Anthropic** — strong engineering, but `inference_geo` offers only `global` and `us`. **No India
  option.** Disqualified as primary for the residency path; retained as a PREMIUM backup for
  off-call work where residency is not required. *(See the disclosure in the research document.)*
- **Cerebras** — ~3,000 tok/s, genuinely attractive for voice, but publishes no per-token price.
- **Together / Mistral** — cheap, but neither documents constrained decoding. Together's own docs
  recommend belt-and-braces prompting, which is an admission that the schema is not enforced.

**Structural note.** Phase 4 already validates every tool call's structure before the registry is
queried, and rejects malformed model output as a typed `ValidationFailure`. That means a provider
without strict mode degrades to *more retries*, not to *unsafe behaviour*. Strict mode is a cost and
latency optimisation here, not a safety control — the safety control is application code, and it
already exists.

---

## 6. EMBEDDINGS

| Provider | Cost /1M | Dims | 1536 drop-in | Verdict |
|---|---|---|---|---|
| **OpenAI `text-embedding-3-small`** | **$0.02** | **1536 native** | **Yes** | **Primary** — cheapest and exact-fit |
| `gemini-embedding-001` | $0.15 / $0.075 batch | configurable | Yes (recommended size) | **Backup** — different vendor, same dimension |
| Voyage `voyage-4-lite` | $0.02 + 200M free | **not published** | **unverified** | Best free tier; blocked pending a dimensions answer |
| Cohere Embed 4 | $0.12 | — | — | 6× for no demonstrated Indic gain |
| Jina | login-walled | — | — | Only vendor naming Hindi; take the 10M free tokens and test |
| BGE-M3 / e5-large | ₹0 | **1024** | **No** | Forces schema migration + full re-embed |

Embeddings are **economically irrelevant** at this scale — under ₹0.001 per conversation-minute.
Choose on dimension compatibility and residency, never on price.

---

## 7. OBJECT STORAGE

| Provider | 100 GB stored + 100 GB read | India jurisdiction | Verdict |
|---|---|---|---|
| **Cloudflare R2** | **$1.35/mo** — free egress | **Not published** (apac hint only) | **Primary** — free egress is decisive for recordings |
| Backblaze B2 | $0.63/mo | Not published | Cheaper, but egress is capped at 3× stored |
| AWS S3 Mumbai | ~$13.4/mo | **Yes — `ap-south-1`** | **The residency escape hatch**, at ~10× |
| DigitalOcean Spaces | $5.00/mo | **Not in BLR1** | Skip |

The platform already addresses objects by opaque key through `ObjectStorage`, so this is the single
cheapest layer to switch. If legal advice comes back requiring Indian residency for recordings,
moving R2 → S3 Mumbai is a config change and a data migration, nothing more.

---

## 8. VOICE STACK COMBINATIONS

Evaluated as combinations, per the brief. All figures INR per conversation-minute, ESTIMATE, derived
from the OFFICIAL rates in the research document.

| # | Telephony | STT | TTS | LLM | ₹/min | Latency posture | India posture |
|---|---|---|---|---|---|---|---|
| **1** | **Plivo India** | **Sarvam** | **Sarvam** | **Sarvam 105B** | **1.58** | **Unknown — nothing published** | **Strongest — all-India, all-INR** |
| **2** | Plivo India | Sarvam | **Azure Central India** | Sarvam | 1.55 | Unknown | Very strong; free TTS tier |
| **3** | Plivo India | **Deepgram** | **Cartesia** | **Gemini 2.5 Flash-Lite** | 3.70 | **Best documented** (~300/90 ms) | Mixed — Cartesia in India, rest not |
| **4** | Plivo India | **Azure** | Azure | `gpt-5.6-luna` | 2.61 | Unknown | Strong — Azure India + OpenAI India endpoint |
| **5** | Plivo India | Sarvam | **Smallest.ai** | Sarvam | 9.63 | **~200 ms TTFB documented** | Strong, USD-billed |
| **6** | **Twilio intl.** | Deepgram | Cartesia | Gemini | 8.49 | Good | **Broken — foreign caller ID** |

**Reading this table.** Combination 1 is 2.3× cheaper than 3 and the strongest on India posture, but
it is the only one where **neither the STT nor the TTS vendor publishes a latency figure**.
Combination 3 costs more but every component publishes numbers you can design a budget against.

**The honest position: this table cannot pick the winner.** Combination 1 is the right thing to
*benchmark first* because if it meets the latency target it wins on every other axis. Combination 3
is the fallback that is already known to be fast. That is a testable plan, not a preference.

Combination 6 is included only to show the cost of getting telephony wrong: the same AI stack costs
2.3× more because of the carrier leg alone — and it still would not work, because of caller ID.

---

## 9. LATENCY BUDGET

`06_PROVIDER_AND_COST_SPEC` §14 sets the target: **under ~1.2 s p50** from end of candidate speech to
first returned audio byte, with a 700–1700 ms end-to-end budget before geography.

Allocation against published figures:

| Stage | Budget | Best published evidence |
|---|---|---|
| Endpointing / VAD | 200–400 ms | **Provider-dependent and largely untunable.** The single largest and most tunable chunk, and it sits *before* STT. |
| Network: carrier media edge → Bangalore VM | 20–250 ms | **Unknown — no provider states where its India media edge is.** Ask, then measure. |
| STT final transcript | ≤200 ms | Gladia 103 ms partials; Deepgram <300 ms; **Sarvam unpublished** |
| LLM time to **first token** | ≤500 ms | No frontier lab publishes TTFT. Groq publishes throughput only. |
| TTS time to first byte | ≤200 ms | Rime P50 96 ms; Cartesia <90 ms; Smallest ~200 ms; **Sarvam unpublished** |
| Return leg to carrier | 20–250 ms | As above |

**Three things this table makes explicit:**

1. **The ≤500 ms LLM allowance only works as time-to-*first-token* with TTS streaming chained onto
   it.** Read as total generation time it is impossible. State it that way or the budget misleads.
2. **Every figure above is a vendor aspiration.** Not one is a measurement of this stack, on Indian
   mobile audio, from a Bangalore VM. The pilot must instrument per-turn latency —
   `endpoint-detected → STT final → LLM first token → TTS first byte → audio out` — and record p50
   and p95. Phase 4 already emits a structured per-turn log line; extending it is small work.
3. **A 700 ms endpointing threshold makes a sub-1-second budget arithmetically unreachable.** If the
   carrier's silence detection cannot be tuned below that, the target moves or the product feels slow.
   Ask Plivo directly what is configurable.

---

## 10. PROVIDER ABSTRACTION MAPPING

The customer-facing surface already exists in code and names no vendor. This is the mapping, and
every row is already implemented as an interface in `packages/providers/src/interfaces.ts`.

```
Customer-facing capability   →   Internal abstraction        →   Provider implementation
──────────────────────────────────────────────────────────────────────────────────────────
Intelligence: Standard       →   IntelligenceProvider        →   Sarvam 105B / Gemini Flash-Lite
Intelligence: Advanced       →   .modelFor('advanced')       →   gpt-5.6-luna / gemini-3.7-flash
Intelligence: Premium        →   .modelFor('premium')        →   gemini-3.1-pro / Claude Sonnet 5

Voice: Standard              →   TextToSpeechProvider        →   Sarvam Bulbul v2 / Azure Neural
Voice: Premium               →   .synthesize(voiceTier)      →   Cartesia Sonic / Smallest Lightning

Language (en-IN, hi-IN…)     →   SpeechToTextProvider        →   Sarvam Saaras / Azure / Deepgram
Calling capacity             →   TelephonyProvider           →   Plivo India / Exotel
Knowledge capacity           →   EmbeddingProvider           →   OpenAI 3-small / Gemini embedding
                             →   KnowledgeStore              →   pgvector (Postgres, BLR1)
Call recordings              →   ObjectStorage               →   Cloudflare R2 / S3 Mumbai
(audio transport)            →   VoicePipeline               →   Phase 5 implementation
```

**The dashboard never needs a vendor name.** `AgentConfiguration` already enforces this: it has
`capabilities.intelligenceTier`, `capabilities.voiceTier`, and `identity.primaryLanguage`, and there
is no field anywhere in the schema through which a model name, voice id, or endpoint could be
expressed. A `.strict()` Zod schema rejects one if someone tries.

### One gap the mapping exposes

`TelephonyProvider` currently declares `originate`, `hangup`, and `verifyWebhook` — but **no
media-stream accessor**. `VoicePipeline.attach` takes `inbound: AsyncIterable<InboundEvent>`, so the
media stream is expected to arrive as inbound events from somewhere.

That seam works, but which collaborator owns the websocket is undecided. **This is a Phase 5 design
question, not a defect** — and per the brief I have not changed anything. Flagging it so the decision
is made deliberately at implementation time rather than discovered.

---

## 11. FAILOVER — where it is real and where it is theatre

| Layer | Failover realistic? | Complexity | Cost of standby | Assessment |
|---|---|---|---|---|
| **LLM** | **Yes — genuinely** | Low | ₹0 | Both providers speak the same normalized contract. Phase 4 already returns typed `ProviderFailure` with a `retryable` flag and bounded retries. Adding a second provider is one adapter and a routing rule. **Do this.** |
| **Embeddings** | **No — not mid-corpus** | — | — | Vectors from different models are **not comparable**. Switching means re-embedding everything. This is a migration, not a failover. Never fail over live. |
| **Object storage** | Yes, easily | Low | ~$1/mo | Opaque keys, dual-write is cheap. Lowest-risk layer in the system. |
| **TTS** | **Yes, but audibly** | Medium | ₹0 | Technically easy — same interface, both stream. But the **voice changes mid-call**, which a candidate will notice. Fail over *between* calls, not within one. |
| **STT** | **Partially** | High | ₹0 | Mid-call swap means reconnecting a stream and losing partial context. Realistic policy: fail over at call boundaries; within a call, a dead STT should end the call cleanly rather than limp. |
| **Telephony** | **Yes, but slowly** | **High** | ₹200/mo + KYC | A second carrier needs its own KYC, its own Indian number, its own DLT header registration. **Weeks of lead time, not seconds.** This is business continuity, not runtime failover. |
| **Voice orchestration** | n/a | — | — | Self-hosted. Failover is ordinary redundancy of your own service. |

**The honest summary.** Only the LLM layer supports true runtime failover, and it is the layer where
Phase 4 already built the machinery. Everything else is either a between-calls decision (TTS, STT) or
a procurement exercise with weeks of lead time (telephony). **Do not design as though the voice path
has hot failover — it does not.**

The right investment is: real failover on LLM, graceful degradation everywhere else, and a
**pre-approved second telephony carrier sitting idle with KYC already complete** so that switching is
days rather than months.

---

## 12. LOCK-IN ASSESSMENT

| Layer | Lock-in | Why | Mitigation |
|---|---|---|---|
| **Telephony** | **HIGH** | India data region is **irreversible at account creation**; KYC, number, DLT header all bind to the entity | Choose the region correctly the first time; keep the adapter thin |
| **Embeddings** | **HIGH** | Vectors are not portable between models | Prefer native-1536 providers so a switch is a re-embed, not a schema change |
| **STT / TTS** | LOW | Standard streaming contracts, already abstracted | — |
| **LLM** | LOW | Normalized contract, tiers not model names | — |
| **Storage** | **VERY LOW** | Opaque keys, S3-compatible APIs | — |
| **Orchestration** | **NONE** | Self-hosted; it is our own code | Do not adopt Vapi/Retell/Bland — they would introduce the highest lock-in in the stack *and* cost more than everything else combined |

**The two high-lock-in decisions are telephony region and embedding dimensions.** Both are cheap to
get right now and expensive to fix later. Everything else in this stack is genuinely replaceable,
which is what the architecture was built for.

---

*Cost model: `PHASE_5_UNIT_ECONOMICS.md`. Recommendation: `PHASE_5_RECOMMENDATION.md`.*
