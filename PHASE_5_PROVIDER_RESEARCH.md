# Phase 5 Pre-Implementation — Provider Research

**Date of research:** 18 August 2026. Every price below was read off a page fetched on that date.
**Status:** research only. No provider selected, no SDK installed, no adapter written, no Phase 5 code.

---

## 0. Method, and how to read this document

Every claim carries a label. The labels are not decoration — they tell you which numbers you may
budget against and which you must go and get yourself.

| Label | Meaning |
|---|---|
| **OFFICIAL** | Read on the provider's own site or docs during this session. The URL is given. |
| **THIRD_PARTY** | Read on a review site, blog, comparison article, or news source. Treat as a lead, not a fact. |
| **NOT_PUBLISHED** | The provider does not publish it. A sales conversation is required. Never estimated. |
| **ESTIMATE** | Derived arithmetically from OFFICIAL numbers. The derivation is shown. |

**No price in this document was recalled from memory.** Where a page could not be fetched, the entry
says so and the number is absent rather than guessed.

**Why that matters, demonstrated.** A search-result summary for Sarvam AI reported "₹45 per hour"
for speech-to-text, "₹30 per 10K characters" for text-to-speech, and "₹1,000 in free credits". The
official pricing page says **₹30/hour** for STT (₹45 is the *diarization* variant), **₹15/10K
characters** for Bulbul v2 TTS, and **₹100** in free credits. Three of three headline figures were
wrong in the direction that would have made the platform look 2–10× more expensive than it is. This
document is built from fetched pages for that reason.

**FX assumption.** USD/INR **95.74** on 18 Aug 2026 (THIRD_PARTY — search aggregation citing
Federal Reserve H.10 and market data; verify against
[federalreserve.gov H.10](https://www.federalreserve.gov/releases/h10/hist/dat00_in.htm) before
committing). Every currency conversion in these documents is therefore an **ESTIMATE** and is
labelled as such. INR-native providers are quoted in INR with no conversion.

**Disclosure.** Anthropic is evaluated below as an LLM provider. I am Claude, made by Anthropic.
I have tried to apply the same standard to Anthropic as to everyone else, and the conclusion I reach
in §D is that Anthropic is **disqualified for the India-residency path** and mid-pack on price. Read
that section with the conflict in mind and check it yourself.

**Research effort.** 13 parallel research and adversarial-verification agents, ~473 tool calls,
covering six provider layers plus Indian telecom and data regulation. Three verification agents
re-fetched load-bearing claims specifically to catch fabrication; their corrections are folded in
and noted where they changed a conclusion.

---

## A. TELEPHONY

This is the layer that decides whether the product is viable at all, and it produced the single
largest finding in the research.

### A.1 The finding that reorganises everything

**Domestic Indian telephony costs roughly one-fourteenth of international termination into India.**

| Route | Rate | Source |
|---|---|---|
| Plivo, India **domestic** outbound | **₹0.38/min** | OFFICIAL — [plivo.com/voice/pricing/in](https://www.plivo.com/voice/pricing/in/) |
| Twilio, international → India mobile | **$0.0496/min** ≈ ₹4.75/min | OFFICIAL — [twilio.com/en-us/voice/pricing/in](https://www.twilio.com/en-us/voice/pricing/in) |
| Twilio Media Streams surcharge | **$0.0044/min** ≈ ₹0.42/min | OFFICIAL — [twilio.com/en-us/voice/pricing](https://www.twilio.com/en-us/voice/pricing) |

Twilio's call-plus-media path is **13.6× Plivo's domestic rate** (ESTIMATE, from the OFFICIAL rates
above at ₹95.74/USD). That is not a tuning difference. It is the difference between a viable unit
economic model and an impossible one.

### A.2 The gate on the domestic rate — and it is irreversible

The ₹0.38/min rate is not available to everyone. Two OFFICIAL statements from Plivo's own docs:

> "Only businesses registered in India can: Rent Indian phone numbers, Make domestic calls within India"
> — [plivo.com/docs/voice/concepts/india-calling](https://www.plivo.com/docs/voice/concepts/india-calling)

> "Indian phone numbers are only available to India data region organizations." … **"Data region
> cannot be changed after an organization is created."**
> — [plivo.com/docs/numbers/rent-india-numbers](https://www.plivo.com/docs/numbers/rent-india-numbers)

**This is an expensive-to-change decision of exactly the kind the architecture process exists to
catch.** Signing up for a Plivo account before the Indian entity exists, or picking the US data
region by default, permanently locks the account onto international rates. The account cannot be
migrated; it must be abandoned and recreated.

KYC requires two documents, both mandatory (OFFICIAL, same page):
- Business Registration: Certificate of Incorporation (MCA) **or** Udyam Registration (MSME); **and**
- Tax: Business PAN **or** GST Certificate.

Company name must match exactly across both. Review is quoted at "15 minutes and up to 1 business
day" for standard 080/022 numbers.

> The **Udyam/MSME** route is a materially cheaper qualifying path than full private-limited
> incorporation and is worth investigating first for a bootstrap.

### A.3 Twilio — disqualified for outbound, useful for one thing

Two OFFICIAL statements settle it:

> "Although we don't have voice enabled numbers in this locale, you can use numbers from over 90
> other locales to make and receive calls."
> — [twilio.com/en-us/sip-trunking/pricing/in](https://www.twilio.com/en-us/sip-trunking/pricing/in)

> "Outbound calls to India can only be made from international (non-Indian) numbers."
> — [twilio.com/en-us/guidelines/in/voice](https://www.twilio.com/en-us/guidelines/in/voice)

A recruitment agent that rings Indian candidates from a foreign caller ID will not be answered at a
usable rate. Combined with the 13.6× price, Twilio cannot carry the outbound dialer.

**Correction applied from adversarial verification:** an earlier draft concluded Twilio could not
offer any Indian callback number. That was wrong. Twilio's India regulatory guidelines list an
**India Toll-Free (+91800)** number type with address requirement "Must be outside of the country"
and "No documentation required" — reachable from within India, **inbound only**, available without
Indian incorporation. That is a genuinely useful fallback for an inbound callback line before the
Indian entity exists. What Twilio lacks is a voice-enabled Indian **local/national/mobile** DID.

Other Twilio rates (all OFFICIAL, [voice pricing](https://www.twilio.com/en-us/voice/pricing)):
SIP trunking to India mobile $0.0456/min; ConversationRelay managed voice-AI $0.07/min; recording
$0.0025/min; recording storage $0.0005/min/month; Twilio's own transcription $0.0500/min (far above
dedicated STT — do not use it). Provision up to 30 CPS in console. $15 trial credit.

### A.4 The rest of the layer

| Provider | India rate published? | Bidirectional websocket media? | Verdict |
|---|---|---|---|
| **Plivo** | **Yes — ₹0.38/min in & out, ₹200/mo number** (OFFICIAL) | **Yes, included at ₹0 extra** (OFFICIAL) | **Primary candidate** |
| **Exotel** | **No** — plans sell ₹-denominated credits; per-minute rate is sales-quoted (NOT_PUBLISHED) | **Yes** — AgentStream Voicebot applet, `wss://` (OFFICIAL) | Capable, but unbudgetable from public data |
| **Telnyx** | **No India rate on any of four pricing pages** (NOT_PUBLISHED) | Yes — $0.0035/min (OFFICIAL) | **Avoid**: 12-month India minimum commitment in their own ToS, on an unpublished rate |
| **Vonage** | Could not verify — every commercial page returned HTTP 403 | Yes (developer docs reachable) | Unevaluable |
| **Acefone** (ex-Servetel) | Seat pricing only: ₹1,599–1,999/user/mo, 5–6 seat minimum (OFFICIAL) | Yes, claimed (OFFICIAL) | Floor ~₹9,594/mo consumes the entire budget before one AI minute |
| **Ozonetel** | **No** — pricing page misconfigured, redirects to a private IP | **Not confirmed** — REST and webhooks only in docs | Cannot evaluate |
| **Knowlarity** | Could not reach — incomplete TLS certificate chain | Unknown | No data |
| **MyOperator** | ₹5,000–15,000/mo, **billed yearly** (OFFICIAL) | Not published | Wrong layer — packaged phone system, not programmable infra |
| **TeleCMI** | Renders no numbers without JavaScript; India path 404s | Unknown | Sales-gated from here |

**Plivo add-ons to avoid** (all OFFICIAL, India pricing page): call transcription ₹0.81/min;
Automatic Speech Recognition **₹1.70 per 15 seconds** (= ₹6.80/min); noise cancellation ₹0.12/min.
Carrier ASR is 13× the price of bringing your own. Call recording and secure trunking are ₹0.00.

**Billing pulse is 30 seconds** on Plivo India (OFFICIAL). Short calls round up; this matters for
voicemail hits.

**Exotel entry pricing** (OFFICIAL, [exotel.com/pricing](https://exotel.com/pricing/)): Dabbler
₹9,999 / 5 months / 5,000 credits / 1 number / 3 agents; Believer ₹19,999 / 11 months / 9,500
credits; Influencer ₹49,499 / 11 months / 39,000 credits. 1 credit = ₹1. **Credits expire with the
plan**, so the plan price is a floor cost regardless of usage. 7-day trial with 500 free credits.
Exotel is India-domiciled with a Mumbai data region (`api.in.exotel.com`) and claims "PCI DSS, DLT,
TRAI, and UL-VNO compliant".

**Exotel's "<20 ms ultra-low latency" claim should not enter any budget.** Adversarial verification
confirmed the figure is on the marketing page but with no measurement basis, no definition of what
is measured, and it is contradicted in order of magnitude by Exotel's own AgentStream developer
guide, which implies ~100 ms framing. Treat Exotel latency as **unpublished**.

### A.5 Latency, from the only provider that publishes a budget

Plivo publishes component targets ([audio streaming
docs](https://www.plivo.com/docs/voice-agents/audio-streaming/overview)) — the only vendor in this
layer that does. Codec is **μ-law 8 kHz with no transcoding**, which is the right answer for PSTN.

**A caution the research surfaced and I am passing on directly:** requesting 16 kHz or "24 kHz HD"
audio from a mobile caller does not get you wideband. The audio has already been through AMR-NB/EVS
on the radio leg and narrowband transcoding at the PSTN handoff. You get upsampled 8 kHz — no extra
information, more bytes, more transcoding delay. **Nobody publishes ASR accuracy on 8 kHz narrowband
Hinglish**, and that is precisely where this product lives or dies. It has to be measured, not
sourced.

---

## B. SPEECH-TO-TEXT

| Provider | Streaming price | Indian English (en-IN) | Hindi | India region | Source |
|---|---|---|---|---|---|
| **Sarvam AI (Saaras v3)** | **₹30/hour** = ₹0.50/min (ESTIMATE from OFFICIAL) | Yes, first-class | Yes, + 20 more Indic | Not stated | [docs.sarvam.ai pricing](https://docs.sarvam.ai/api-reference-docs/pricing) |
| **AssemblyAI** | $0.15/hour = $0.0025/min (ESTIMATE) | **No en-IN dialect** | Yes (pre-recorded) | No | [assemblyai.com/pricing](https://www.assemblyai.com/pricing) |
| **Deepgram Nova-3** | $0.0048/min mono, $0.0058 multi | **Yes — only Deepgram tier with en-IN** | Yes | Not stated | [deepgram.com/pricing](https://deepgram.com/pricing) |
| **OpenAI** | `gpt-4o-mini-transcribe` $0.003/min; live path `gpt-live-transcribe` **$0.017/min** | Not published | Not explicitly named | India endpoint exists (see §D) | [developers.openai.com pricing](https://developers.openai.com/api/docs/pricing) |
| **Azure AI Speech** | **$1.00/hour** = $0.0167/min (ESTIMATE) | Yes | Yes + 10 Indic | **Yes — Central India, verified** | Retail Prices API, `centralindia` |
| **Gladia (Solaria-1)** | $0.75/hr Starter, $0.25/hr on commit | Not named | Not named | No | [gladia.io/pricing](https://www.gladia.io/pricing) |
| **ElevenLabs Scribe v2 Realtime** | $0.39/hour | Not verified | Yes | No | [elevenlabs.io/pricing](https://elevenlabs.io/pricing) |
| **Google Cloud STT** | **Could not read a single price** in 8 fetch attempts | Yes — hi-IN and en-IN on 7 models | Yes + 9 Indic | Region table not published | [cloud.google.com/speech-to-text](https://cloud.google.com/speech-to-text/pricing) |
| **AI4Bharat IndicWhisper** | ₹0 licence, self-hosted | 12 Indic languages | Yes | You choose | Open source |
| **Reverie** | Unreachable — expired TLS certificate | — | — | — | — |

**Sarvam is the price leader by a wide margin** — ₹30/hour is roughly 1/8th of Gladia Starter
real-time and materially below every USD-denominated option once converted. It is also the only
provider whose docs treat **Hinglish code-mixing as a first-class feature** (a `codemix` mode on
Saaras). Its streaming API exposes three stream types, with `fast` documented as lowest-latency and
intended for voice agents. Rate limits: 60 req/min Starter, 200 Pro, 1,000 Business (OFFICIAL).

**Azure is the only STT with a verified India region** (Central India / Pune, confirmed via
Microsoft's own machine-readable Retail Prices API) and is uniquely explicit about Hindi-English
multilingual handling — but at $1.00/hour it is ~3× Sarvam after conversion.

**AI4Bharat IndicWhisper is the right answer for the wrong phase.** Zero marginal cost and total
data control, but **no streaming support** and a 26.8 WER on the noisy real-world benchmark. It is
where this layer should go when volume makes per-hour fees hurt, not where it starts.

**Published latency figures** (all OFFICIAL, all marketing-grade unless noted): Gladia "partial
transcripts in under 103 ms" and "sub-300 ms end-to-end"; ElevenLabs Scribe v2 Realtime "~150 ms†"
(dagger footnote not captured); Deepgram "under 300 milliseconds" with no percentile. **Sarvam
publishes no latency figure at all** — this is the single biggest unknown in the recommended stack
and must be benchmarked before commitment.

---

## C. TEXT-TO-SPEECH

| Provider | Price | Hindi | Hinglish/code-switch | India hosting | Published latency |
|---|---|---|---|---|---|
| **Sarvam Bulbul v2** | **₹15 / 10K chars** (OFFICIAL) → **₹1.35/min** (ESTIMATE) | Yes, 11 Indic locales, en-IN first-class | Implied, not documented | India-native, INR billing | **None published** |
| **Cartesia Sonic-3.6** | $49/mo ≈ 1,667 min → **$0.0294/min** (ESTIMATE) | Yes (42 languages) | **Explicitly demonstrated** | **Yes — "data centers in India"** (OFFICIAL, [cartesia.ai/regions/india](https://cartesia.ai/regions/india)) | "sub-90 ms" |
| **Smallest.ai Lightning** | ~$0.09/min (OFFICIAL) | Yes, 10 Indic | **Documented auto language routing** | India company, USD billing | **~200 ms TTFB** (best-documented) |
| **Azure Neural TTS** | **$15 / 1M chars** (OFFICIAL, Central India) | Yes, 9+ hi-IN voices, 16+ en-IN | Yes | **Yes — Central India** | None published |
| **ElevenLabs Flash v2.5** | $0.05 / 1K chars (OFFICIAL) | Yes | Not documented | **None** | "~75 ms†" (excl. network) |
| **Rime Coda** | $0.05 / 1K chars (OFFICIAL) | Yes — **Coda only** | No | No | **P50 96 ms, P90 98 ms** (best-quality figures) |
| **Google Chirp 3: HD** | $10/1M chars (**THIRD_PARTY** — could not read the official table in 8 attempts) | Yes — broadest Indic coverage | — | Not verified | None published |
| **Deepgram Aura-2** | $0.030 / 1K chars | **No Hindi. No Indian English.** | No | No | "sub-200 ms TTFB" |

**Deepgram Aura is disqualified** for an India-first product: the developer docs list Aura-2 as
supporting English (American, British, Australian, Irish, Filipino), Spanish, German, French, Dutch,
Italian and Japanese. No Hindi. No Indian English accent.

**Rime is a pricing trap worth naming:** the headline $0.03/1K belongs to Mist v3, which does *not*
support Hindi. Hindi is only on Coda at $0.05/1K.

**Azure's free tier is the most valuable thing in this layer for a bootstrap:** a recurring
**0.5M free characters per month** (OFFICIAL) — roughly 1,300 minutes of synthesised speech monthly
at zero cost, in a verified Indian region.

**Cartesia is the only TTS vendor with an explicit India data-centre claim**, and the only one that
publicly demonstrates Hinglish code-switching.

---

## D. LLM

### D.1 Prices as published on 18 Aug 2026 (all OFFICIAL)

**Cost-efficient tier** — the models a voice agent would actually run on:

| Model | Input /1M | Cached input /1M | Output /1M |
|---|---|---|---|
| `gemini-2.5-flash-lite` | $0.10 | — | $0.40 |
| `gpt-5-nano` | $0.05 | $0.005 | $0.40 |
| `gpt-5.6-luna` | $0.20 | $0.02 | $1.20 |
| `gemini-3.1-flash-lite` | $0.25 | — | $1.50 |
| `gpt-5-mini` | $0.25 | $0.025 | $2.00 |
| `gemini-3.5-flash-lite` | $0.30 | — | $2.50 |
| `deepseek-v4-flash` (off-peak) | $0.22 | $0.007 | $0.66 |
| **Sarvam 105B** | **₹29.28** | **₹10.98** | **₹73.2** |
| `openai/gpt-oss-120b` (Groq) | $0.15 | — | $0.60 |
| Claude Haiku 4.5 | $1.00 | $0.10 | $5.00 |

**Higher tiers:** `gemini-3.7-flash` $0.75/$3.75 · Claude Sonnet 5 $2/$10 (introductory pricing made
permanent; the increase to $3/$15 scheduled for 1 Sep 2026 was formally cancelled) · `grok-4.6`
$2/$6 · `gemini-3.1-pro-preview` $2/$12 · Claude Opus 5 $5/$25 · `gpt-5.6-sol` $5/$30.

Sources: [developers.openai.com/api/docs/pricing](https://developers.openai.com/api/docs/pricing) ·
[platform.claude.com pricing](https://platform.claude.com/docs/en/about-claude/pricing) ·
[ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) ·
[docs.sarvam.ai pricing](https://docs.sarvam.ai/api-reference-docs/pricing) ·
[api-docs.deepseek.com](https://api-docs.deepseek.com/quick_start/pricing) ·
[groq.com/pricing](https://groq.com/pricing) · [x.ai](https://x.ai/api) ·
[together.ai/pricing](https://www.together.ai/pricing) · [mistral.ai/pricing](https://mistral.ai/pricing)

### D.2 The criteria that actually matter here

The brief is explicit that this is not an intelligence beauty contest. Judged on tool calling,
structured output, India posture and cost:

**India data residency — the discriminator most comparisons ignore:**

- **OpenAI publishes a dedicated India data-residency endpoint** (`in.api.openai.com`), and India is
  listed as a supported country. This is the strongest India posture of the three frontier labs and
  it is not widely known. **OFFICIAL.**
- **Google Gemini**: India is listed among available regions for the Gemini API — access confirmed,
  **residency unverified**.
- **Anthropic**: the `inference_geo` parameter accepts exactly two values — `global` and `us`.
  **There is no India option.** For a product storing candidate PII under DPDP this is
  **disqualifying for the residency-sensitive path**, regardless of model quality. (Stated with the
  disclosure in §0 in mind.)
- **DeepSeek** is China-based. For a product handling Indian candidate PII, that requires a
  cross-border transfer analysis before a single transcript is sent.

**Strict tool calling — verified, not assumed:**

- **DeepSeek** documents true strict mode: *"In `strict` mode, the model strictly adheres to the
  format requirements of the Function's JSON schema"*, with server-side schema validation. Best
  verified guarantee in the group.
- **xAI**: *"When using supported schema features, the response is guaranteed to match your schema."*
  Cleanest strict-tools guarantee, but 6–25× too expensive for this budget.
- **Groq** — **disqualifying restriction**: strict schema enforcement is GPT-OSS-only **and mutually
  exclusive with both streaming and tool use**. A voice agent needs all three simultaneously.
- **Together AI** and **Mistral** support function calling and `response_format`, but their docs do
  **not** claim constrained decoding. Together's own guidance recommends belt-and-braces prompting,
  which is an admission.
- **Sarvam** supports `tools`, `tool_choice`, and `response_format` with both `json_object` and
  `json_schema`, plus SSE streaming.
- **Cerebras** does not publish per-token pricing at all — fastest published throughput
  (~3,000 tok/s on gpt-oss-120b) but unmodellable.

**Published throughput** (OFFICIAL, Groq): gpt-oss-20b 1,000 tok/s; gpt-oss-120b 500 tok/s. No
frontier lab publishes TTFT. Anthropic publishes a comparative ranking (Haiku 4.5 "Fastest") which
is more than OpenAI or Google give.

---

## E. EMBEDDINGS

The platform already stores `pgvector(1536)`. Dimension compatibility, not price, is the binding
constraint.

| Provider | Price /1M tokens | Native dims | Drop-in at 1536? |
|---|---|---|---|
| **OpenAI `text-embedding-3-small`** | **$0.02** (OFFICIAL) | **1536** | **Yes — zero migration** |
| Voyage `voyage-4-lite` | $0.02 + **200M free tokens** (OFFICIAL) | Not published | **Unverified — blocker** |
| `gemini-embedding-001` | $0.15 ($0.075 batch) | configurable | Yes — 1536 is a recommended `output_dimensionality` |
| `gemini-embedding-2` | $0.20 ($0.10 batch) | configurable | Yes |
| Cohere Embed 4 | $0.12 | — | 6× OpenAI for no demonstrated Indic advantage |
| Jina | **Not published — login required** | — | Only provider explicitly naming Hindi; 10M free tokens |
| BGE-M3 / multilingual-e5-large | ₹0 licence | **1024** | **No — forces a schema migration and full re-embed** |

The self-hosted open models are blocked on **dimensions, not quality**. Both emit 1024. Adopting
either means altering the `pgvector` column and re-embedding the entire corpus.

---

## F. OBJECT STORAGE AND PLATFORM INFRASTRUCTURE

### F.1 Object storage — egress is the whole question

Call recordings are written once and read back repeatedly.

| Provider | Storage /GB-mo | Egress | 100 GB stored + 100 GB read (ESTIMATE) |
|---|---|---|---|
| **Cloudflare R2** | $0.015 | **$0 — free, unlimited** | **$1.35/mo** |
| Backblaze B2 | $0.00695 | Free to 3× stored, then $0.01/GB | $0.63/mo |
| AWS S3 Mumbai (`ap-south-1`) | $0.025 | **$0.1093/GB** | ~$13.4/mo |
| DigitalOcean Spaces | $5 base + $0.02/GiB | $0.01/GiB | $5.00/mo — **not available in BLR1** |

R2 free tier: 10 GB storage, 1M Class A, 10M Class B operations per month (OFFICIAL).
**R2 publishes no India jurisdiction** — location hints go only as far as `apac`. If Indian data
residency for recordings turns out to be contractually required, S3 Mumbai is the only option here
that provides it, at roughly 10× the cost.

### F.2 Platform infrastructure — the Indian-region requirement is decisive

`06_PROVIDER_AND_COST_SPEC` §14 makes Indian-region compute a hard requirement, not a preference,
because hosting outside India adds ~150–250 ms on the telephony leg **on every conversational turn**.

| Provider | India region | Managed Postgres in that region | Cheapest realistic stack |
|---|---|---|---|
| **DigitalOcean** | **Yes — BLR1 Bangalore** | **Yes** | $12/mo self-managed; **$36.15/mo fully managed** (ESTIMATE) |
| Fly.io | Yes — Mumbai `bom` | **No — MPG not available in Mumbai** | $5.92/mo machine, but DB must live elsewhere |
| Hetzner | **No** — nearest is Singapore | n/a | €26.49/mo Singapore CPX22 — best value, worst latency |
| Railway | **No** — Singapore is nearest | n/a | ~$40.43/mo for 1 vCPU + 2 GB always-on |
| Neon | **No India region at all** | n/a | — |

**DigitalOcean BLR1 is the only option combining a real Indian region with managed Postgres in that
same region.** Fly.io's Mumbai region is a trap for this use case — you would have the app in India
and the database outside it, which reintroduces exactly the round trip the requirement exists to
avoid. Railway's per-second model punishes the always-on API and worker a voice platform needs.

DigitalOcean OFFICIAL rates: Droplet 2 vCPU / 4 GiB $24/mo; Managed PostgreSQL from $15.15/mo;
Managed Valkey from $15.00/mo.

---

## G. INDIA TELECOM AND DATA REGULATION

> ## ⚠️ REQUIRES LEGAL VERIFICATION
>
> Everything in this section is research, not legal advice. Several of the most commercially
> important questions **do not have a clean published answer** and must be settled in writing with a
> qualified Indian telecom/privacy lawyer **and** with your access provider before a single outbound
> call is placed. Where I could not find an authoritative source, the entry says so rather than
> guessing.

### G.1 The governing regime — in force

**TCCCPR 2018, as amended 21 Dec 2018 and 12 Feb 2025**, applies "throughout the territory of India"
and is the live regime as of 18 Aug 2026.
Sources: [TRAI TCCCPR 2018](https://trai.gov.in/sites/default/files/2025-01/RegulationUcc19072018.pdf) ·
[Second Amendment, 12 Feb 2025](https://www.trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf)

Three hard gates for a commercial voice product:
1. Register as a **Sender** with an Access Provider.
2. Obtain a number in the **designated series** matching your traffic type.
3. **File a written auto-dialer / robo-call declaration with the Originating Access Provider before
   dialling.**

Whether "DLT for voice" exists in the same form as DLT for SMS **does not have a clean published
answer**. It exists as entity/consent/preference registration. Settle it in writing with your access
provider.

### G.2 The biggest commercial risk in the entire research

**A recruitment screening call is most likely classified PROMOTIONAL.**

The reasoning: it is not *transactional* (fails the "existing Customer" and "within thirty minutes of
a customer-initiated transaction" tests), and it is not a *service* call under limb (i) (the
candidate is not your customer and there is no product they purchased). TRAI's own explanatory
memorandum sweeps calls to "prospective customers" into promotional.

If that classification holds, the consequences are structural, not cosmetic:
- **140-series numbers only** — not the 080/022 geographic DIDs that Plivo provisions in a day.
- **Explicit digital consent per candidate**, captured through the Digital Consent Acquisition
  platform rather than your own signup form.
- **DND/NCPR-registered candidates may not be callable at all.**

A defensible contrary argument exists (a candidate who applied for a job has initiated the
relationship), but it is an argument, not a settled position. **This single question determines
whether the product as conceived is legal in its default configuration.** Get it answered first.

### G.3 Consent has a seven-day shelf life

Under the February 2025 amendment, **explicit consent for commercial communication is valid for
7 days**. Inferred consent lasts only for the duration of the contractual relationship.

This is a data-model requirement, not a compliance checkbox: consent is a **perishable, per-candidate,
timestamped asset with a one-week expiry**. A candidate who applied ten days ago may be outside the
window. The schema must model consent capture time, source, and expiry, and the dialer must refuse
to place a call against expired consent — the same "check before the action, never after" discipline
already used for tool authorization in Phase 4.

### G.4 Other binding obligations

- **DND/NCPR scrubbing is mandatory before every campaign.** Prior engagement does not waive it.
  **Unresolved:** none of the seven NCPR preference categories is "recruitment/HR/staffing". Nothing
  official resolves which category applies, or whether it defaults to block-all.
- **Calling window restricted to 09:00–21:00** — the dialer needs a scheduler.
- **Penalties** (THIRD_PARTY figures, verify): 5+ complaints in 10 days can trigger number suspension
  within 5 days; ₹1 lakh first violation, ₹2 lakh per subsequent; repeat-offender status brings a ban
  of up to 6 months plus DLT blacklisting — which is reported to be **entity-level, not
  number-level**. In 2025 over 731,000 notices were issued and ~90,000 entities banned.
  **For an AI bot dialing strangers, complaint-rate is the highest-probability way this business
  dies**, and it needs a monitored threshold with an automatic campaign abort — not a dashboard
  someone checks weekly.

### G.5 Draft Third Amendment 2026 — names AI voice agents directly

[TRAI Draft Consultation Paper, 13 March 2026](https://www.trai.gov.in/sites/default/files/2026-03/Draft_CP_13032026_0.pdf).
Consultation closed 12 April 2026; **not yet notified, not law**. It is the clearest official signal
that Indian regulators intend to treat AI voice agents as regulated A2P/robo traffic. Track
[trai.gov.in/release-publication/regulations](https://www.trai.gov.in/release-publication/regulations).

### G.6 DPDP Act 2023 and Rules 2025 — in force

Act enacted 11 Aug 2023; **Rules notified 14 Nov 2025**; phased compliance runway ending
approximately mid-May 2027.
Sources: [MeitY DPDP Act](https://www.meity.gov.in/content/digital-personal-data-protection-act-2023) ·
[DPDP Rules 2025](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa)

Call recordings, transcripts and candidate records are personal data. The platform and each employer
client will need to establish who is Data Fiduciary and who is Data Processor — that allocation is a
contract term, and it should be decided before the first customer, not after.

**Blanket data localisation is NOT established** for ordinary data fiduciaries; it is framed as
conditional and Significant-Data-Fiduciary-specific. **Recommendation regardless: store in an Indian
region by default.** The cost delta is small and the downside of being wrong is not.

### G.7 Call recording consent — no authoritative rule located

This is one of the two weakest-evidence items in the research. No authoritative Indian source was
readable in this session.

**Engineering posture that is safe under any plausible resolution:** announce recording at the top of
every call, capture an affirmative verbal acknowledgement, store that acknowledgement as part of the
record, and provide a documented deletion route. That satisfies the DPDP notice-and-consent layer and
is defensible either way.

### G.8 A product decision worth making deliberately

I found **no TRAI rule requiring disclosure that the caller is an AI**. But for a recruitment product
the reputational and consent-integrity case for disclosing it in the opening line is strong, and the
draft Third Amendment signals the direction of travel. **Make it a stated product decision rather
than an oversight.**

Separately: AI-assisted candidate screening is classified **high-risk under the EU AI Act** (relevant
the moment a client or candidate is EU-linked), and carries discrimination exposure anywhere. **Accent
bias in ASR is a documented failure mode** that maps directly onto protected characteristics in a
country with India's linguistic diversity. This is a product-design risk, not only a legal one.

---

## H. What could not be verified

Recorded so the gaps are visible rather than silently absent:

| Item | Why |
|---|---|
| Vonage — all commercial pricing | Every pricing page returned HTTP 403 to automated fetching |
| Google Cloud STT — all pricing | 8 fetch attempts across 6 URLs, every one truncated before the pricing table |
| Google Cloud TTS — official price table | Same; the $10/1M Chirp 3 HD figure is **THIRD_PARTY only** |
| Knowlarity — everything | Incomplete TLS certificate chain on both hosts |
| Reverie — everything | Expired TLS certificate |
| Ozonetel — all pricing | Pricing page redirects to a private IP (10.230.20.107:8080) |
| TeleCMI — all pricing | Page renders no numbers without JavaScript; India path 404s |
| Exotel — per-minute voice rate | NOT_PUBLISHED; sales quote required |
| Telnyx — India per-minute rate | NOT_PUBLISHED on four separate pricing pages |
| Cerebras — per-token pricing | NOT_PUBLISHED |
| Jina — embedding price | Login required |
| Voyage — embedding dimensions | Not on the pricing page; blocks the 1536 drop-in check |
| Sarvam — any latency figure | Not published anywhere. **The largest unknown in the recommended stack.** |
| Sarvam — data residency / hosting region | Not stated in docs. Must be asked directly if DPDP residency matters. |
| Plivo — concurrency ceiling per DID, outbound CPS | Not published; confirmed absent from the India pricing page |
| Plivo — GST treatment | Not mentioned anywhere on the India pricing page |
| Answering-machine detection | Not researched for Plivo or Exotel; Twilio prices it separately |
| ASR accuracy on 8 kHz narrowband Hinglish | **No vendor publishes this.** Must be measured. |

---

## I. Categories the research initially missed, then added

An adversarial completeness pass caught a whole provider category and several cost dimensions that
the layer-by-layer structure had hidden.

**Voice-agent orchestration platforms** (2026 rates, THIRD_PARTY unless noted): Vapi ~$0.05/min
platform fee on top of bring-your-own components; Retell ~$0.07/min (~$0.105–0.15 all-in); Bland
$0.11–0.14/min bundled with $299–499/mo plans; LiveKit ~$0.01/min agent fee after a ~$50 base;
Pipecat open-source, self-hosted, zero licence cost.

**The conclusion this forces:** Vapi's $0.05/min orchestration fee alone is ≈₹4.79/min — **about
12× the entire Plivo call cost, and 3× the entire recommended stack**. On this budget the managed
orchestration platforms are structurally unaffordable. Self-hosted **Pipecat or LiveKit Agents on a
Bangalore VM** is the only orchestration layer that fits both the budget and the in-India media
requirement — and it is also what the Phase 1–4 architecture already is. The platform has, in effect,
already built the layer these vendors sell.

**Cost dimensions that were missing and are now in the economics document:** 18% GST on Indian
telecom services; DLT Principal Entity registration (~₹5,900 one-time, 5–10 business days,
THIRD_PARTY); the answer-rate funnel; 30-second billing pulse; Exotel credit expiry as an unpriced
minimum commit; Indian entity formation (~₹15,000–25,000 and 2–4 weeks, THIRD_PARTY).

**Realistic time-to-first-call is 6–10 weeks, not days** — entity formation → GST → Plivo KYC → DLT
registration → header approval. That belongs above any per-minute rate in planning.

---

*Comparison and tiering: `PHASE_5_PROVIDER_COMPARISON.md`. Cost model:
`PHASE_5_UNIT_ECONOMICS.md`. Recommendation: `PHASE_5_RECOMMENDATION.md`.*
