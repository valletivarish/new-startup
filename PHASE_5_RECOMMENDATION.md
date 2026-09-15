# Phase 5 Pre-Implementation — Recommendation

**Status: for founder review. Nothing has been selected, installed, or committed to.**

Built from `PHASE_5_PROVIDER_RESEARCH.md` (sources), `PHASE_5_PROVIDER_COMPARISON.md` (tiering and
failover), and `PHASE_5_UNIT_ECONOMICS.md` (cost model).

---

## 0. The three things that matter most

If you read nothing else:

**1. There is one irreversible decision, and it is not a technical one.**
Plivo's docs state: *"Indian phone numbers are only available to India data region organizations"*
and *"Data region cannot be changed after an organization is created."* Domestic Indian calling
requires an India-registered entity. **Sign up for nothing until the Indian entity exists**, then
choose the India data region deliberately. Getting this wrong locks the account onto international
rates — 13.6× more expensive — with no migration path.

**2. The biggest risk to this business is regulatory, not technical.**
A recruitment screening call is **most likely classified PROMOTIONAL** under TCCCPR 2018 as amended.
If that holds: 140-series numbers only, per-candidate explicit digital consent with a **7-day expiry**,
and DND-registered candidates possibly unreachable. Reported penalties reach ₹2 lakh per violation
with **entity-level** DLT blacklisting. **This question must be answered by counsel before any
engineering commitment**, because the answer changes the product, not just the paperwork.

**3. The economics work, and speech — not the phone call — is the cost.**
₹1.58 per conversation-minute; **₹8.48 per completed screen** including GST and answer-rate waste.
TTS is 36% of cost, STT 32%, telephony 24%, LLM under 8%. ~70% gross margin at plausible prices.
The ₹10,000/month budget supports roughly **800 completed screens per month**.

---

## 1. Recommendation by layer

### TELEPHONY

| | |
|---|---|
| **Primary** | **Plivo — India data region** |
| **Backup** | **Exotel** (get a written quote now, do not wait) |
| **Why** | The only provider publishing an India rate you can budget against (₹0.38/min in and out, ₹200/mo number, OFFICIAL) *and* including bidirectional websocket media at **no surcharge**. Every alternative is either sales-gated, disqualified, or unevaluable. |
| **Cost** | ₹0.38/min, 30-second pulse. 24% of variable cost. |
| **Quality** | μ-law 8 kHz with no transcoding — correct for PSTN. Publishes component latency targets, the only vendor in the layer that does. |
| **India** | Strongest available, but hard-gated on an India-registered entity and an irreversible region choice. |
| **Lock-in** | **HIGH** — region is irreversible; KYC, number and DLT header bind to the entity. |
| **Complexity** | Low to integrate; **6–10 weeks of non-engineering lead time** before the first call. |

**Rejected:** Twilio (no voice-enabled Indian DID; outbound to India only from foreign caller IDs;
13.6× the price). Telnyx (**12-month India minimum commitment** in their own ToS, on a rate published
nowhere). Acefone (5–6 seat minimum ≈ ₹9,594/mo floor consumes the entire budget). Ozonetel,
Knowlarity, TeleCMI, Vonage (unevaluable — misconfigured pricing pages, broken TLS, or 403s).
MyOperator (packaged phone system, not programmable infrastructure).

**Use Twilio for exactly one thing:** an **India Toll-Free (+91800)** inbound callback line. It is
available to a foreign entity with no documentation, and it gives candidates a number to call back
before the Indian entity exists.

---

### SPEECH-TO-TEXT

| | |
|---|---|
| **Primary** | **Sarvam AI (Saaras v3)** — *conditional on a latency benchmark* |
| **Backup** | **Azure AI Speech (Central India)** |
| **Why** | ₹30/hour is the price leader by a wide margin, with 22 Indic languages and the only documented **Hinglish `codemix` mode** in the survey. Indian recruitment calls are code-mixed in practice; no other vendor treats that as a feature. INR billing removes FX exposure. |
| **Cost** | ₹0.50/min (32% of variable cost). Azure backup: ₹1.60/min. |
| **Quality** | Strongest Indic breadth outside Google. **Unmeasured on 8 kHz narrowband Hinglish — which no vendor publishes and which must be tested.** |
| **India** | INR-native, all `*-IN` locales. **Data residency not stated in docs — ask directly.** |
| **Lock-in** | Low — standard streaming contract, already abstracted behind `SpeechToTextProvider`. |
| **Complexity** | Low. Rate limits 60 req/min on Starter — verify this supports target concurrency. |

> **⚠ The one condition.** Sarvam publishes **no latency figure anywhere**. Everything else fits
> perfectly. If measured time-to-final-transcript breaks the ≤200 ms allowance, fall back to Azure
> Central India (in-country, verified region) or Deepgram Nova-3 (en-IN + Hindi, "<300 ms").

---

### TEXT-TO-SPEECH

| | |
|---|---|
| **Primary** | **Sarvam Bulbul v2** — *conditional on the same latency benchmark* |
| **Backup** | **Azure Neural TTS (Central India)**, then **Cartesia Sonic** for premium voice |
| **Why** | ₹15/10K characters, 11 Indic locales with en-IN as a first-class locale, INR-billed. Azure's **recurring 0.5M free characters per month** is the most valuable free tier in the entire research — roughly 1,300 minutes of speech monthly at zero cost, in a verified Indian region. |
| **Cost** | ₹0.57/min — **the single largest line in the stack, 36% of variable cost.** |
| **Quality** | Good Indic coverage. Cartesia is the only vendor publicly demonstrating Hinglish code-switching and the only one with **published India data centres**. |
| **India** | Sarvam INR-native; Azure Central India verified; Cartesia has India data centres. |
| **Lock-in** | Low, but **switching mid-call changes the voice audibly** — fail over between calls only. |
| **Complexity** | Low. |

**Disqualified:** Deepgram Aura — no Hindi, no Indian English. **Pricing trap to avoid:** Rime's
headline $0.03/1K is Mist v3, which does not support Hindi; Hindi is Coda at $0.05/1K.

> **This is the highest-leverage decision in the cost model.** Moving TTS from Sarvam to Cartesia
> raises total variable cost **2.4×**, from ₹1.58 to ₹3.82/min. Benchmark before quoting any customer
> price.

---

### LLM

| Tier | Primary | Backup |
|---|---|---|
| **STANDARD** | **Sarvam 105B** (₹29.28 / ₹10.98 cached / ₹73.2 per 1M) | `gemini-2.5-flash-lite` ($0.10/$0.40) |
| **ADVANCED** | `gpt-5.6-luna` ($0.20/$0.02/$1.20) | `gemini-3.7-flash` ($0.75/$3.75) |
| **PREMIUM** | `gemini-3.1-pro-preview` ($2/$12) | Claude Sonnet 5 ($2/$10) — *residency permitting* |

| | |
|---|---|
| **Why** | Sarvam is INR-billed, Hinglish-native, and supports `tools`, `tool_choice`, `json_object`, `json_schema` and SSE streaming — everything the Phase 4 runtime needs. **OpenAI is the only frontier lab publishing an India data-residency endpoint** (`in.api.openai.com`), which makes `gpt-5.6-luna` the natural ADVANCED tier at exceptional value (1.05M context). |
| **Cost** | **Under 8% of variable cost — optimise it last.** `gpt-5.6-luna` is actually 3% *cheaper* than Sarvam at current FX. Choose on reliability and residency, not price. |
| **Quality** | Strict tool calling verified on DeepSeek and xAI; Sarvam and OpenAI support tools and JSON schema without a published constrained-decoding guarantee. |
| **India** | OpenAI: India endpoint (best of the frontier labs). Gemini: available, residency unverified. **Anthropic: `inference_geo` offers only `global` and `us` — no India option.** |
| **Lock-in** | **Lowest in the stack.** Normalized contract, tiers not model names. |
| **Complexity** | Already built. Swapping in a real provider is one DI binding in `app.module.ts`. |

**Rejected with reasons:** **Groq** — strict schema is GPT-OSS-only *and mutually exclusive with
streaming and tool use*; a voice agent needs all three simultaneously. **DeepSeek** — best verified
strict mode and cheap, but China-based; candidate transcripts are personal data under DPDP, so this
needs a completed cross-border transfer analysis first. **xAI** — cleanest guarantee, 6–25× too
expensive. **Cerebras** — fastest published throughput, no published price. **Together/Mistral** —
no constrained-decoding claim.

**Anthropic is disqualified as primary on India residency**, not on quality. *(Disclosure: I am
Claude, made by Anthropic. Verify this conclusion yourself — the `inference_geo` documentation is
[here](https://platform.claude.com/docs/en/about-claude/pricing).)*

**A structural comfort:** Phase 4 already validates tool-call structure before the registry is
queried and rejects malformed output as a typed `ValidationFailure`. A provider without strict mode
degrades to *more retries*, not to *unsafe behaviour*. The safety control is application code, and it
already exists.

---

### EMBEDDINGS

| | |
|---|---|
| **Primary** | **OpenAI `text-embedding-3-small`** — $0.02/1M |
| **Backup** | **`gemini-embedding-001`** — $0.15/1M ($0.075 batch) |
| **Why** | 3-small emits **1536 dimensions natively** — an exact drop-in for the existing `pgvector(1536)` column, zero migration. Gemini supports `output_dimensionality` with 1536 as a recommended size, so the backup is a genuine swap rather than a rewrite. |
| **Cost** | **Under 0.1% of variable cost.** Economically irrelevant. |
| **Lock-in** | **HIGH** — vectors are not portable between models. Switching means re-embedding the entire corpus. **Never fail over live.** |
| **Complexity** | Already built and tested behind `EmbeddingProvider`. |

**Do not adopt** BGE-M3 or multilingual-e5-large yet: both emit **1024** dimensions, forcing a schema
migration and a full re-embed. **Worth investigating:** Voyage `voyage-4-lite` at $0.02/1M with
**200M free tokens** — which would cover the entire bootstrap phase at zero cost — but the pricing
page does not publish dimensions. One email answers it.

---

### OBJECT STORAGE

| | |
|---|---|
| **Primary** | **Cloudflare R2** — $0.015/GB-month, **free unlimited egress** |
| **Backup** | **AWS S3 Mumbai (`ap-south-1`)** — if residency is contractually required |
| **Why** | Recordings are written once and read back repeatedly. R2's free egress makes it ~10× cheaper than S3 Mumbai on that pattern ($1.35 vs ~$13.40 for 100 GB stored + 100 GB read). |
| **Cost** | Negligible — ~₹81/month at 10,000 min/month with 12-month retention. |
| **India** | **R2 publishes no India jurisdiction** (only an `apac` location hint). This is the deciding factor if legal advice requires Indian residency for recordings. |
| **Lock-in** | **Very low** — opaque keys, S3-compatible API, already abstracted. |

---

### PLATFORM INFRASTRUCTURE

| | |
|---|---|
| **Primary** | **DigitalOcean BLR1 (Bangalore)** |
| **Backup** | **AWS Mumbai** if residency or scale demands it |
| **Why** | The **only** provider combining a real Indian region with **managed PostgreSQL in that same region**. Indian-region compute is a hard architectural requirement (§14) — hosting outside India adds 150–250 ms per conversational turn. |
| **Cost** | **Start lean: $24/mo Droplet + $1 R2 = ₹2,394/mo.** Managed Postgres + Valkey adds $30/mo. |
| **Complexity** | Low — the Docker Compose stack already runs this way. |

**Rejected:** **Fly.io** — has a Mumbai region but **Managed Postgres is unavailable there**, so the
database would sit outside India and reintroduce exactly the round trip the requirement exists to
prevent. **Hetzner** — best price-per-resource, no India region. **Railway** — no India region, and
per-second billing punishes the always-on API and worker a voice platform needs. **Neon** — no India
region at all.

> **Start with self-managed Postgres and Redis on the Droplet.** It roughly doubles the usage the
> ₹10,000 budget supports (818 vs 417 completed screens/month). Move to managed when the backup story
> or operational load justifies it — not before.

---

### VOICE ORCHESTRATION

| | |
|---|---|
| **Recommendation** | **Keep it in-house. Do not adopt a managed voice-agent platform.** |
| **Why** | Vapi ~$0.05/min, Retell ~$0.07/min, Bland $0.11–0.14/min (THIRD_PARTY). Vapi's orchestration fee alone is ≈₹4.79/min — **12× the entire Plivo call cost and 3× the entire recommended stack**. None of them can satisfy in-India media anchoring, and they would introduce the highest lock-in in the system. |
| **What to use instead** | The runtime built in Phases 1–4, plus a self-hosted media layer (Pipecat or LiveKit Agents) on the Bangalore VM if one is needed. |

**The platform has already built the layer these vendors sell.** The event-stream runtime, tool
authorization, context assembly and safety limits are exactly what Vapi and Retell charge per minute
for. Buying it back would be paying a premium to give up control of the thing that differentiates
the product.

---

## 2. RECOMMENDED BOOTSTRAP STACK

```
Telephony:
  Primary:   Plivo — India data region (India-registered entity required)
  Backup:    Exotel (obtain written quote before launch)
  Inbound:   Twilio India Toll-Free +91800 (no Indian entity needed — interim callback line)

STT:
  Primary:   Sarvam AI Saaras v3          ₹30/hour     [CONDITIONAL ON LATENCY BENCHMARK]
  Backup:    Azure AI Speech, Central India  $1.00/hour
  Fallback:  Deepgram Nova-3 (en-IN + Hindi)  $0.0048/min

LLM:
  Standard:  Sarvam 105B                  ₹29.28 / ₹10.98 cached / ₹73.2 per 1M
  Advanced:  gpt-5.6-luna                 $0.20 / $0.02 / $1.20 per 1M  (India endpoint)
  Premium:   gemini-3.1-pro-preview       $2.00 / $12.00 per 1M
  Backups:   gemini-2.5-flash-lite · gemini-3.7-flash · Claude Sonnet 5 (residency permitting)

TTS:
  Primary:   Sarvam Bulbul v2             ₹15 / 10K chars  [CONDITIONAL ON LATENCY BENCHMARK]
  Backup:    Azure Neural TTS, Central India  $15/1M chars + 0.5M free chars/month
  Premium:   Cartesia Sonic-3.6           ~$0.029/min (India data centres, sub-90ms)

Embeddings:
  Primary:   OpenAI text-embedding-3-small  $0.02/1M — 1536 dims, exact drop-in
  Backup:    gemini-embedding-001           $0.15/1M — 1536 supported
  Investigate: Voyage voyage-4-lite         $0.02/1M + 200M free tokens (dimensions unpublished)

Storage:
  Primary:   Cloudflare R2                $0.015/GB-mo, free egress
  Backup:    AWS S3 Mumbai (ap-south-1)    if Indian residency is required

Infrastructure:
  Primary:   DigitalOcean BLR1 (Bangalore) — Droplet + self-managed Postgres/pgvector + Redis
  Backup:    AWS Mumbai
  Later:     DO Managed PostgreSQL + Managed Valkey when ops load justifies +$30/mo

Orchestration:
  In-house (Phases 1–4 runtime). Self-hosted Pipecat/LiveKit Agents if a media layer is needed.
  Explicitly NOT Vapi / Retell / Bland.
```

**Economics of this stack:** ₹1.58/conversation-minute · **₹8.48/completed screen** (incl. GST) ·
₹3,060/month fixed · **~800 completed screens/month within ₹10,000**.

---

## 3. Where quality was NOT sacrificed for budget — and where it might be

The brief asks explicitly: *if a cheaper provider has materially worse quality, say so.*

**Where cheap and good coincide** (no trade-off made):
- **Plivo telephony** — cheapest *and* the only one with published rates, free bidirectional media,
  and a real India posture.
- **OpenAI embeddings** — cheapest *and* the exact dimension fit.
- **Cloudflare R2** — cheapest for this access pattern *and* operationally simplest.
- **DigitalOcean BLR1** — not cheapest overall, chosen for the Indian region. Correct trade.

**Where a real trade-off exists and is being deferred to measurement:**
- **Sarvam STT and TTS are chosen partly on price**, and they are the two components that publish
  **no latency figures at all**. The vendors with the best-documented latency — Cartesia (sub-90 ms),
  Rime (P50 96 ms), Smallest.ai (~200 ms TTFB), Gladia (103 ms partials) — cost 2.4–15× more.
  **This is a genuine quality risk, and it is not resolved by this document.** It is resolved by the
  benchmark in §5.

**Where I would spend more without hesitation:**
- If Sarvam fails the latency test, **pay for Cartesia**. A 2.4× cost increase still leaves ~50% gross
  margin at the hypothetical prices, and a laggy voice agent is not a product — it is a demo that
  loses candidates mid-call.

---

## 4. The decisions that are expensive to change later

Following the same discipline as the ADR process.

| Decision | Reversibility | Do this |
|---|---|---|
| **Plivo data region** | **IRREVERSIBLE** — account must be abandoned and recreated | Create the entity first; then choose India deliberately |
| **Indian entity form** (Pvt Ltd vs Udyam/MSME) | Expensive | Investigate Udyam/MSME first — materially cheaper and both satisfy Plivo KYC |
| **Embedding model / dimensions** | Expensive — full re-embed | Stay at 1536; verify Voyage's dimensions before considering it |
| **Consent data model** | Expensive once candidate data exists | Model consent as **perishable with a 7-day expiry** from day one |
| **DLT registration / number series** | Expensive — weeks of lead time | Resolve the promotional-vs-service classification **before** registering |
| **Storage jurisdiction** | Cheap | R2 now; S3 Mumbai if legal requires it |
| **LLM provider** | **Cheap** — one DI binding | No need to decide early |
| **STT / TTS provider** | Cheap | Benchmark, then decide |

---

## 5. What to do next, in order

**These are recommendations for founder decision, not actions I have taken or will take
unprompted.**

### Before any engineering

1. **Get legal advice on the classification question.** Is a recruitment screening call to a
   candidate who applied for a job *promotional*, *service*, or *transactional* under TCCCPR 2018 as
   amended? This determines the number series, the consent regime, and whether DND-registered
   candidates are reachable. Everything else waits on it.
2. **Ask counsel the DND/NCPR category question** — none of the seven preference categories is
   recruitment/HR/staffing, and nothing official resolves which applies.
3. **Decide the entity form** — investigate Udyam/MSME before defaulting to Pvt Ltd.
4. **Get a written Exotel quote** so a second telephony source exists on paper before you need one.

### The benchmark that decides the stack

Run `06_PROVIDER_AND_COST_SPEC` §16 against **two candidate stacks**, on real Indian mobile audio,
from a Bangalore VM:

- **Stack A (recommended):** Plivo + Sarvam STT + Sarvam TTS + Sarvam 105B
- **Stack B (latency-safe):** Plivo + Deepgram Nova-3 + Cartesia Sonic + `gemini-2.5-flash-lite`

Measure and record, per turn: `endpoint-detected → STT final → LLM first token → TTS first byte →
audio out`, at **p50 and p95**. Also measure **word error rate on 8 kHz narrowband Hinglish**, which
no vendor publishes and which is where this product lives or dies.

**Free credits make this nearly free:** Sarvam ₹100 · Deepgram $200 · AssemblyAI $50 · Gladia €50 ·
Azure 0.5M chars/month recurring · Cartesia free tier · Voyage 200M tokens · Twilio $15.

**Decision rule, set in advance:** if Stack A meets the ≤1.2 s p50 target, take it — it wins on every
other axis. If it does not, take Stack B and reprice.

### Questions to put to providers in writing

- **Plivo:** What concurrency does a ₹200/month DID support? What is the outbound CPS limit? Where is
  the India media edge (Mumbai? Chennai?) and what RTT should we expect from a BLR1 VM? Is the
  endpointing/silence threshold configurable? Is GST included, and is input tax credit available?
  Do you offer answering-machine detection, and what does it add to call setup?
- **Sarvam:** What is the measured latency of the `fast` stream type? Where is inference hosted — is
  there Indian data residency? What concurrency does the Starter 60 req/min limit imply?
- **Exotel:** Written per-minute rate, AgentStream surcharge, and what happens when plan credits hit
  zero mid-campaign.
- **Voyage:** What are `voyage-4-lite`'s output dimensions?

### What is explicitly NOT recommended yet

- Do not install any provider SDK.
- Do not write a production adapter.
- Do not select a final provider — the benchmark decides STT and TTS.
- Do not begin Phase 5 implementation.

---

## 6. What would change this recommendation

Stated in advance, so the recommendation is falsifiable rather than a preference:

| Finding | Consequence |
|---|---|
| Sarvam latency fails the ≤1.2 s budget | TTS → Cartesia, STT → Deepgram or Azure. Cost rises 2.4×; reprice. |
| Recruitment calls classified **promotional** | 140-series only, 7-day consent, DND blocks. **Product model changes**, not just plumbing. |
| Legal requires Indian residency for recordings | R2 → S3 Mumbai; storage cost ~10×, still small. |
| Legal requires Indian residency for inference | Anthropic and most global vendors drop out. Sarvam + Azure Central India become close to mandatory. |
| Plivo concurrency ceiling is low | Capacity is concurrency-bound; plans must be priced on concurrent calls, and Exotel becomes urgent. |
| Answer rate is materially below 35% | Cost per completed screen rises proportionally. **The largest uncertainty in the model.** |
| Rupee moves >5% | Every USD line shifts. Another point in favour of the INR-native stack. |

---

## 7. Honest limitations of this research

- **No benchmark has been run.** Every quality and latency claim is a vendor's, not a measurement.
  The comparison document can narrow the field; it cannot pick the winner.
- **Seven providers could not be evaluated** — Vonage, Ozonetel, Knowlarity, TeleCMI, Reverie, and
  the official pricing tables for Google Cloud STT and TTS — because of 403s, broken TLS, misconfigured
  pricing pages, or JavaScript-only rendering. Two of them (Ozonetel, Knowlarity) are India-domiciled
  and could matter.
- **The licensed-telco tier was not researched at all** — Airtel IQ, Tata Tele Business Services,
  Jio CPaaS. As licensed operators they are the ones who can actually provision and vouch for
  140/1600-series compliance, which is the open regulatory question. **Worth adding before commitment.**
- **The regulatory section is research, not legal advice**, and several load-bearing items are
  THIRD_PARTY. It is labelled REQUIRES LEGAL VERIFICATION throughout and must be treated that way.
- **Call recording consent has no authoritative source** located. The recommended engineering posture
  (announce, capture acknowledgement, store it, offer deletion) is defensible but not verified.
- **FX is a single point estimate** on a date. Every conversion inherits that.

---

## 8. Status

Phase 5 implementation has **not** started. No provider SDK is installed. No adapter has been
written. No provider has been selected. The architecture is unchanged.

Awaiting founder review.
