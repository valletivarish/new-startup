# Phase 5B — Decision Matrix and Provider Classification

**Status: for founder review. No provider selected. Phase 5 implementation has not started.**

Per the brief, **Sarvam is not declared the winner**. This document defines a scoring framework,
applies it, and classifies every provider — including the ones that score well but remain unproven.

---

## 1. The benchmark score

Seven dimensions, each scored **0–5**. Weights reflect what this specific product cannot compromise
on, not generic importance.

| Dimension | Weight | What a 5 means | What a 0 means |
|---|---|---|---|
| **Quality** | 20% | Verified output quality for Indian English and Hindi in a telephony context | Unusable or wrong-language |
| **Latency** | 20% | Published percentile figures inside the ≤1.2 s p50 turn budget | No figure published, or known to exceed budget |
| **Cost** | 15% | Fits comfortably inside ₹10,000/month at pilot volume | Structurally unaffordable |
| **India language support** | 15% | Indian English + Hindi + code-mixing as first-class documented features | No Indic support |
| **Streaming** | 15% | Bidirectional real-time to our own endpoint, fully specified | None, or unidirectional only |
| **Reliability** | 8% | Published SLA, rate limits, concurrency figures | Nothing published, no trial to test with |
| **Provider independence** | 7% | Standard contract, trivially swappable, no lock-in | Irreversible commitment or proprietary format |

**Scores are judgement calls from documented evidence, not measurements.** No benchmark has been run.
A score of 0 for Latency means "not published" as often as it means "slow" — and the distinction is
recorded in the notes rather than hidden in the number.

**Critical rule applied throughout:** for telephony, **Streaming is a gate, not a weight.** A carrier
that cannot stream bidirectionally to our endpoint scores 0 overall regardless of everything else,
because the architecture cannot use it at any price.

---

## 2. TELEPHONY

Gate applied first: bidirectional websocket media to our own endpoint, Indian caller ID, domestic
routing.

| Provider | Gate | Qual | Lat | Cost | India | Stream | Rel | Indep | **Score** |
|---|---|---|---|---|---|---|---|---|---|
| **Plivo (India region)** | ✅ | 4 | 3 | **5** | 5 | 5 | 2 | 3 | **4.02** |
| **TTBS Smartflo** | ✅ | 4 | 2 | 2 | 5 | 5 | 3 | 2 | **3.38** |
| **Knowlarity** | ✅ | 4 | 2 | 3 | 4 | **5** | 2 | 1 | **3.23** |
| **Exotel** | ✅ | 4 | 1 | 2 | 5 | 5 | 1 | 3 | **3.09** |
| **Twilio** | ❌ India outbound | 5 | 4 | 0 | 0 | 5 | 5 | 4 | **gate fail** |
| **Airtel IQ** | ❌ no media plane | — | — | — | — | **0** | — | — | **0** |
| **Ozonetel** | ❌ no media plane | — | — | — | — | **0** | — | — | **0** |
| **Tanla** | ❌ no media plane | — | — | — | — | **0** | — | — | **0** |
| **Jio (JioCX)** | ❌ no media plane | — | — | — | — | **0** | — | — | **0** |
| **Tata Comms / Kaleyra** | ❓ unknown | ? | ? | ? | ? | ? | ? | ? | **unscored** |
| **Telnyx** | ✅ | 4 | 4 | ? | 2 | 5 | 3 | 1 | **unscored** — India rate unpublished, 12-month minimum |
| **Vonage** | ✅ | ? | ? | ? | ? | 5 | ? | ? | **unscored** — all commercial pages 403 |

**Notes on the scores that matter:**

- **Plivo Reliability = 2.** No published SLA, no rate limits, no concurrency ceiling, and **no free
  tier to test with**. It leads on everything else and is weakest exactly where a single-source
  dependency hurts most.
- **TTBS Cost = 2.** ₹20,000 setup plus ₹1,100/concurrency is more expensive than Plivo at every
  volume up to its own 5,000-minute fair-use ceiling. It is a compliance and second-source play.
- **Knowlarity Independence = 1.** One-year minimum contract, quarterly advance payment.
- **Knowlarity Streaming = 5** — the best audio specification found anywhere: linear16 PCM with a
  **selectable sample rate** (8k–48k), where everyone else is fixed μ-law 8 kHz.
- **Exotel Reliability = 1.** Concurrency entirely unpublished, and the Voicebot applet reportedly
  needs a human to enable it.

---

## 3. SPEECH-TO-TEXT

| Provider | Qual | Lat | Cost | India | Stream | Rel | Indep | **Score** | Latency evidence |
|---|---|---|---|---|---|---|---|---|---|
| **Sarvam Saaras v3** | 4 | **0** | **5** | **5** | 4 | 3 | 4 | **3.42** | **None published** |
| **Azure Speech (Central India)** | 4 | 3 | 3 | 5 | 4 | **5** | 4 | **3.88** | None, but in-country RTT |
| **Deepgram Nova-3** | 4 | 4 | 4 | 3 | 5 | 4 | 4 | **4.00** | "<300 ms", no percentile |
| **Gladia Solaria-1** | 3 | **5** | 2 | 1 | 5 | 3 | 4 | **3.32** | **103 ms partials** |
| **ElevenLabs Scribe v2 RT** | 3 | 4 | 4 | 2 | 5 | 3 | 4 | **3.57** | ~150 ms† |
| **AssemblyAI** | 3 | 1 | **5** | 1 | 5 | 3 | 4 | **2.97** | None |
| **OpenAI live transcribe** | 3 | 1 | 2 | 3 | 5 | 4 | 4 | **2.90** | None |
| **Google Cloud STT** | 4 | 1 | ? | **5** | 4 | 4 | 4 | **unscored** — no price readable |
| **AI4Bharat IndicWhisper** | 3 | 1 | **5** | 4 | **0** no streaming | 2 | 5 | **2.66** | None |

**Deepgram (4.00) and Azure (3.88) both outscore Sarvam (3.42)** — precisely because Sarvam's
Latency score is 0 for *unpublished*, and its Reliability is capped by the same gap.

> **This is why Sarvam is not declared the winner.** It leads on cost and India language support by a
> wide margin, and is unscoreable on the dimension that decides whether a voice agent feels usable.
> The framework refuses to award it a score it has not earned.

---

## 4. TEXT-TO-SPEECH

| Provider | Qual | Lat | Cost | India | Stream | Rel | Indep | **Score** | Latency evidence |
|---|---|---|---|---|---|---|---|---|---|
| **Sarvam Bulbul v2** | 4 | **0** | **5** | **5** | 4 | 3 | 4 | **3.42** | **None published** |
| **Azure Neural TTS** | 4 | 2 | **5** | 5 | 4 | **5** | 4 | **3.98** | None; 0.5M free chars/mo |
| **Cartesia Sonic-3.6** | 4 | **5** | 2 | 4 | 5 | 4 | 3 | **3.98** | sub-90 ms; **India data centres** |
| **Smallest.ai Lightning** | 4 | 4 | 1 | **5** | 4 | 3 | 3 | **3.55** | **~200 ms TTFB documented** |
| **Rime Coda** | 4 | **5** | 2 | 2 | 5 | 4 | 4 | **3.75** | **P50 96 ms / P90 98 ms** |
| **ElevenLabs Flash v2.5** | **5** | 5 | 2 | 3 | 5 | 4 | 4 | **4.10** | ~75 ms† (excl. network) |
| **Google Chirp 3: HD** | 4 | 1 | ? | **5** | 4 | 4 | 4 | **unscored** — price not readable |
| **Deepgram Aura-2** | 4 | 5 | 4 | **0** no Hindi | 5 | 4 | 4 | **gate fail** |

**ElevenLabs Flash tops the table at 4.10 — and this is a good illustration of why a weighted score
is not a decision.** It wins on quality and latency, but scores 2 on cost and 3 on India (no India
hosting, Hinglish undocumented), which are the two dimensions a bootstrapped India-first product
cannot flex on. **Azure and Cartesia tie at 3.98**, and both are better *fits* despite the lower
score: Azure for a verified Indian region plus a recurring free tier, Cartesia for published sub-90 ms
latency plus India data centres.

**Deepgram Aura fails the India language gate outright.** No Hindi, no Indian English.

---

## 5. LLM

| Provider / tier | Qual | Lat | Cost | India | Stream | Rel | Indep | **Score** |
|---|---|---|---|---|---|---|---|---|
| **Sarvam 105B** (STANDARD) | 3 | 1 | 4 | **5** | 5 | 3 | 4 | **3.42** |
| **`gemini-2.5-flash-lite`** (STANDARD alt) | 4 | 3 | **5** | 3 | 5 | 4 | 5 | **4.02** |
| **`gpt-5.6-luna`** (ADVANCED) | 4 | 3 | 4 | **4** India endpoint | 5 | 4 | 5 | **4.02** |
| **`gemini-3.7-flash`** (ADVANCED alt) | 4 | 3 | 3 | 3 | 5 | 4 | 5 | **3.72** |
| **`gemini-3.1-pro-preview`** (PREMIUM) | 5 | 2 | 2 | 3 | 5 | 4 | 5 | **3.57** |
| **Claude Sonnet 5** (PREMIUM alt) | **5** | 3 | 3 | **1** us/global only | 5 | 5 | 5 | **3.70** |
| **DeepSeek v4-flash** | 4 | 2 | **5** | **0** China/PII | 5 | 3 | 4 | **3.22** |
| **Groq gpt-oss-120b** | 3 | **5** | 5 | 2 | **0** strict∥stream∥tools | 4 | 4 | **3.25** |
| **xAI grok-4.6** | 4 | 2 | 1 | 2 | 5 | 4 | 5 | **3.07** |

**The LLM layer is where scores are closest and stakes are lowest** — it is under 9% of variable cost
in every economic scenario. Choose on tool-calling reliability and residency, not price.

**Groq's Streaming = 0** is not about network streaming: strict schema enforcement is GPT-OSS-only
**and mutually exclusive with both streaming and tool use**. A voice agent needs all three at once.

**Anthropic's India score = 1, not 0.** Per the correction in `PHASE_5B_PROVIDER_VALIDATION.md` §5:
the first-party API offers `global` and `us` only, and workspace geo is currently `us` only — so it
cannot satisfy a **strict India-only inference** requirement. It is not unsuitable for every
residency scenario, and partner-cloud regional options are unresolved rather than absent.

---

## 6. EMBEDDINGS AND STORAGE

Both are economically negligible — under 0.6% of variable cost combined. Scored on fit, not price.

| Provider | Fit | Note |
|---|---|---|
| **OpenAI `text-embedding-3-small`** | **Best** | 1536 dims native — exact drop-in for existing `pgvector(1536)`, $0.02/1M |
| `gemini-embedding-001` | Good | 1536 a recommended `output_dimensionality` — genuine swap, not a rewrite |
| Voyage `voyage-4-lite` | **Blocked** | $0.02/1M + **200M free tokens**, but dimensions unpublished |
| BGE-M3 / e5-large | **No** | 1024 dims — forces schema migration and full re-embed |
| **Cloudflare R2** | **Best** | Free egress; decisive for read-back-heavy recordings |
| AWS S3 Mumbai | Escape hatch | Real India residency at ~10× |

---

## 7. FINAL CLASSIFICATION

### PRIMARY CANDIDATE

| Provider | Layer | Why | Condition |
|---|---|---|---|
| **Plivo (India data region)** | Telephony | Only provider with a published, budgetable India rate *and* free bidirectional media. Cheapest at every modelled volume. | Indian entity + **irreversible** India data region choice |
| **TTBS Smartflo** | Telephony | Licensed carrier, published pricing, fully specified bidirectional websocket. The genuine second source Phase 5 said did not exist. | ₹20,000 setup; "unlimited" is **5,000 pooled min/month** |
| **OpenAI `text-embedding-3-small`** | Embeddings | Cheapest *and* exact 1536-dim fit. Nothing to trade off. | — |
| **Cloudflare R2** | Storage | Free egress decides it for recordings. | Revisit if India residency becomes mandatory |
| **DigitalOcean BLR1** | Infrastructure | Only provider combining a real Indian region with managed Postgres in that region. | — |

### BACKUP CANDIDATE

| Provider | Layer | Why not primary |
|---|---|---|
| **Knowlarity** | Telephony | Best audio spec found (linear16, selectable rate), but 1-year minimum, quarterly advance, agent-first call topology, and streaming price unpublished |
| **Exotel** | Telephony | Broadest eligibility and well-documented Voicebot applet, but no published per-minute rate, no concurrency figures, and the applet reportedly needs a human to enable |
| **Azure AI Speech (Central India)** | STT | Scores highest overall; ~3× Sarvam's cost. The safety net if Sarvam's latency fails |
| **Azure Neural TTS (Central India)** | TTS | Highest score in its layer; recurring 0.5M free chars/month is the best bootstrap tier found |
| **Deepgram Nova-3** | STT | Best non-Indian fallback: en-IN + Hindi with a published latency claim |
| **Cartesia Sonic-3.6** | TTS | The quality-and-latency answer if Sarvam fails: sub-90 ms and India data centres, at ~5× the cost |
| **`gemini-2.5-flash-lite`** | LLM | Highest-scoring STANDARD option; loses to Sarvam only on INR billing and Hinglish specificity |
| **`gemini-embedding-001`** | Embeddings | Different vendor, same dimension |
| **AWS S3 Mumbai** | Storage | The residency escape hatch |
| **Twilio** | Telephony (inbound/global) | +91800 toll-free inbound without an Indian entity; global expansion; mature Media Streams |

### EXPERIMENTAL

| Provider | Layer | What makes it experimental |
|---|---|---|
| **Sarvam (STT, TTS, LLM)** | Speech + LLM | Best cost and Indic support by a wide margin, and **publishes no latency figure at all**. Everything rests on an unrun benchmark. Also: data residency unstated. |
| **Smallest.ai Lightning** | TTS | Only vendor publishing both ~200 ms TTFB *and* documented English-Hindi code-switching — but ~15× Sarvam's cost |
| **Rime Coda** | TTS | Best-documented latency (P50 96 ms) but Hindi only on the expensive model |
| **Anthropic Claude** | LLM (PREMIUM) | Viable where strict India-only inference is not required; partner-cloud India regions unresolved |
| **Voyage `voyage-4-lite`** | Embeddings | 200M free tokens would cover the whole bootstrap; blocked on one unpublished number |
| **Airtel SIP trunking** | Telephony | The one Airtel path that could carry media to our stack; commercials entirely unpublished |
| **Tanla (compliance only)** | DLT tooling | Cannot carry the call, but operates Trubloq DLT — possibly useful for registration and header provisioning |
| **AI4Bharat IndicWhisper** | STT | Zero marginal cost and full data control; no streaming support, so wrong phase |

### NOT SUITABLE

| Provider | Layer | Disqualifying reason |
|---|---|---|
| **Airtel IQ** | Telephony | **No media plane.** Verified two ways: complete OpenAPI spec (7 endpoints, none streaming) and a grep of 21 JS bundles (0 hits for mediaStream/audioStream/streamUrl/sipUri/mulaw). Plus ~15% GST haircut on top-ups and 90-day credit expiry |
| **Ozonetel** | Telephony | **No media streaming**, established by enumerating their complete published API index (`llms.txt`) |
| **Tanla** | Telephony | Pre-recorded OBD broadcast + hosted IVR. "websocket" appears nowhere across 14 pages |
| **Jio (JioCX)** | Telephony | No self-serve CPaaS voice API. Upload-a-WAV model. Dev portal behind a login wall |
| **Twilio** | Telephony (India **outbound**) | No voice-enabled Indian DID; outbound to India only from non-Indian numbers → foreign caller ID |
| **Deepgram Aura** | TTS | No Hindi, no Indian English |
| **Groq** | LLM | Strict schema is GPT-OSS-only and mutually exclusive with streaming and tool use |
| **DeepSeek** | LLM | China-based; candidate transcripts are personal data under DPDP. Revisit only after a transfer analysis |
| **BGE-M3 / multilingual-e5** | Embeddings | 1024 dims — forces migration and full re-embed |
| **DigitalOcean Spaces** | Storage | Not available in BLR1 |
| **Fly.io** | Infrastructure | Mumbai region exists but Managed Postgres is unavailable there |
| **Hetzner / Railway / Neon** | Infrastructure | No India region |
| **Vapi / Retell / Bland** | Orchestration | ~₹4.79/min platform fee alone — 3× the entire recommended stack; cannot satisfy in-India media anchoring |
| **Acefone** | Telephony | 5–6 seat minimum ≈ ₹9,594/month floor |
| **MyOperator** | Telephony | Packaged phone system, no published streaming, annual billing |

### UNVERIFIED

| Provider | Layer | What blocked verification |
|---|---|---|
| **Tata Communications / Kaleyra** | Telephony | Docs login-gated, one docs host DNS-dead, API reference JS-only. *Absence of evidence from a gated portal is not evidence of absence* |
| **Vonage** | Telephony | Every commercial page returned HTTP 403 |
| **Telnyx** | Telephony | India rate unpublished across four pricing pages; 12-month India minimum in their own ToS |
| **TeleCMI** | Telephony | Pricing renders only with JavaScript; India path 404s |
| **Reverie** | STT | Expired TLS certificate |
| **Google Cloud STT / TTS** | Speech | Official price tables unreadable after 8 fetch attempts across 6 URLs |
| **Jina** | Embeddings | Pricing behind login |
| **Cerebras** | LLM | No per-token pricing published |
| **Ozonetel CloudAgent pricing** | Telephony | Main pricing page unreachable |

---

## 8. What this framework says, and what it deliberately does not

**Says clearly:**

- **Telephony is settled enough to act on.** Plivo primary, TTBS as a licensed second source, both
  verified against the one gate that matters. Four providers eliminated on evidence, not impression.
- **Storage, infrastructure and embeddings are settled.** Cheap, low lock-in, clear winners.
- **The LLM layer barely matters economically** and has the lowest lock-in in the stack. Do not spend
  decision energy here.

**Deliberately does not say:**

- **Which STT and TTS to use.** Sarvam scores 3.42 on both; Azure scores 3.88 (STT) and 3.98 (TTS),
  Deepgram 4.00 (STT). The gap is almost entirely the Latency dimension, where Sarvam scores 0 for
  *unpublished* rather than *slow*.
  **A single benchmark could move Sarvam to the top of both tables or eliminate it.** Declaring a
  winner now would be asserting a measurement nobody has taken.

**The decision rule, set in advance so it cannot be rationalised afterwards:**

> Benchmark Sarvam STT and TTS against Azure Central India and Deepgram/Cartesia, on **real Indian
> mobile audio, from a Bangalore VM**, measuring **p50 and p95** for
> `endpoint-detected → STT final → LLM first token → TTS first byte → audio out`, plus **word error
> rate on 8 kHz narrowband Hinglish** — which no vendor publishes.
>
> - If Sarvam meets the ≤1.2 s p50 budget → **Sarvam wins both layers** on cost, INR billing and
>   Indic support, and the ₹10,000 budget supports ~591 five-minute screens/month.
> - If it does not → **Azure Central India** for both (verified region, free TTS tier), or **Cartesia**
>   for TTS if premium latency justifies ~5× the cost. Marginal cost roughly doubles and pricing must
>   change with it.

**Free credits make this benchmark nearly free:** Sarvam ₹100 · Deepgram $200 · AssemblyAI $50 ·
Gladia €50 · Azure 0.5M chars/month recurring · Cartesia free tier · Voyage 200M tokens · Twilio $15 ·
Exotel 500 credits + ₹6,000 startup programme · Airtel 500 pulses.

---

## 9. The two decisions that are still irreversible

Unchanged from Phase 5, and both remain the highest-consequence items:

1. **Plivo India data region** — *"Data region cannot be changed after an organization is created."*
   Create the Indian entity first. Investigate the **Udyam/MSME** route before defaulting to Pvt Ltd.
2. **Embedding dimensions** — stay at 1536. Verify Voyage's dimensions before considering it.

And one that is not technical:

3. **The TCCCPR classification question** remains **unresolved and requires legal validation**
   (`PHASE_5B_PROVIDER_VALIDATION.md` §4). Knowlarity's own docs now provide carrier-side
   corroboration that it has operational teeth: *"Transactional campaigns are not allowed by default
   due to legal restrictions set by TRAI."*

---

## 10. Status

Phase 5 implementation has **not** started. Nothing installed. No application code modified. No
provider adapter created. No provider selected.

Awaiting founder review.
