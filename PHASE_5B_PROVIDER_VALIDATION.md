# Phase 5B — Provider Validation and Corrections

**Date of validation:** 18 August 2026. Every claim below was re-fetched from the provider's own
page on that date.
**Status:** validation round. **Phase 5 implementation has not started.** Nothing installed, no
application code changed, no provider adapter written, no provider selected.

**Purpose:** correct six specific overreaches in `PHASE_5_PROVIDER_RESEARCH.md` and
`PHASE_5_RECOMMENDATION.md`, re-anchored on current official pages.

---

## Summary of corrections

| # | Earlier claim | Status after re-verification |
|---|---|---|
| 1 | Plivo India ₹0.38/min | **Confirmed current.** Plus a new finding: AMD is free. |
| 2 | Sarvam ₹30/hr, ₹15/10K, ₹100 credits | **Confirmed current.** One official page could not be read; recorded separately. |
| 3 | "Twilio is out" | **Overreach — corrected.** Unsuitable as *assumed primary Indian outbound carrier*; global/fallback use remains open. |
| 4 | Recruitment calls "most likely promotional" | **Overreach — corrected.** Classification is **unresolved** and requires legal validation against seven named factors. |
| 5 | Anthropic "disqualified on India residency" | **Overreach — corrected.** Precisely: the **first-party API** cannot satisfy a **strict India-only inference** requirement. Not disqualified for every residency scenario. |
| 6 | Unit economics built on the above | **Rebuilt** — see `PHASE_5B_UNIT_ECONOMICS.md`. |

---

## 1. Plivo India — pricing source of truth

**Source:** [plivo.com/voice/pricing/in](https://www.plivo.com/voice/pricing/in/), fetched
18 Aug 2026. This page is the **pricing source of truth** for the cost model; nothing in the
economics document uses a rate from anywhere else for this layer.

Currently published (all **OFFICIAL**, currency shown on the page as ₹):

| Item | Rate |
|---|---|
| Domestic outbound voice | **₹0.38/min** |
| Domestic inbound voice | **₹0.38/min** |
| Browser SDK / WebRTC (out and in) | ₹0.25/min |
| **Audio streaming** | **Included — no additional per-minute charge** |
| Billing pulse | **30 seconds** |
| Domestic phone number rental | ₹200.00/month |
| **Answering Machine Detection** | **₹0.00/min** |
| Call recording | ₹0.00/min |
| Conference calls | ₹0.00/min |
| Multilingual Text to Speech | ₹0.00/min |
| Noise cancellation | ₹0.12/min |
| Call transcription | ₹0.81/min |
| Automatic Speech Recognition | ₹1.70 per 15 seconds |

**The ₹0.38/min figure is confirmed by the current official page.** It is retained.

### New finding: answering-machine detection is free

The earlier research flagged AMD as an unpriced unknown and a genuine risk — without it, the agent
delivers a full screening interview to a voicemail greeting and you pay for every second. **Plivo
publishes AMD at ₹0.00/min.** That materially improves the funnel economics and is now modelled
explicitly in `PHASE_5B_UNIT_ECONOMICS.md` (voicemail hits are truncated to ~30 seconds rather than
running the full call length).

### Carrier ASR remains the wrong choice, and the current page confirms why

At ₹1.70 per 15 seconds, Plivo's ASR is **₹6.80/min** — roughly 13.6× Sarvam's ₹0.50/min. Carrier
transcription at ₹0.81/min is 1.6×. **Bring your own STT.**

### What the page still does not say

Confirmed absent from the current page: **GST or tax treatment, minimum commitment, concurrency
limits, CPS limits.** These remain open questions for a written answer from Plivo, and the economics
document assumes 18% GST on top.

---

## 2. Sarvam AI — pricing source of truth, and a page conflict

**Source of truth:** [docs.sarvam.ai/api-reference-docs/pricing](https://docs.sarvam.ai/api-reference-docs/pricing),
fetched 18 Aug 2026. All **OFFICIAL**:

| Item | Rate |
|---|---|
| Speech-to-Text | **₹30/hour** (billed per second) |
| Speech-to-Text + Diarization | ₹45/hour |
| Speech-to-Text + Translate | ₹30/hour |
| **TTS — Bulbul v2** | **₹15 / 10K characters** |
| **TTS — Bulbul v3 (beta)** | **₹30 / 10K characters** |
| Sarvam 105B — input / cached / output | ₹29.28 / ₹10.98 / ₹73.2 per 1M tokens |
| Free credits | **"Every new user receives ₹100 worth of free credits to explore all our APIs."** |

Plan rate limits (OFFICIAL): Starter 60 req/min · Pro 200 · Business 1,000 · Enterprise custom.

### The ₹100 free-credit figure is treated as current and official

Quoted verbatim above from the docs pricing page. **This is the figure used throughout.**

### Conflicting official page — recorded separately, as instructed

`https://www.sarvam.ai/api-pricing` — a second official Sarvam page — **returned HTTP 403 Forbidden**
to automated fetching on 18 Aug 2026 and **could not be read**.

A third-party search summary attributed **"₹1,000 in free credits"** to that page, along with
"₹45/hour" STT and "₹30 per 10K characters" TTS — all three of which contradict the docs page and,
where checkable, are wrong (₹45 is the *diarization* rate; ₹30/10K is *Bulbul v3*, not v2).

**Resolution applied:** the docs pricing page is treated as the source of truth. The marketing page
is recorded as **unreadable, not contradicting** — I cannot assert a conflict between two pages when
I could only read one. **This is worth 60 seconds of the founder's time to check in a browser**, and
if the two pages genuinely disagree, ask Sarvam which governs.

---

## 3. Twilio — corrected scope of the finding

### What was said before, and why it was too broad

The earlier documents said Twilio is "out" and "cannot carry the outbound dialer". The second half
is supportable; the first half over-generalised from an India-specific limitation to a verdict on the
provider.

### What the current official page actually says

**Source:** [twilio.com/en-us/guidelines/in/voice](https://www.twilio.com/en-us/guidelines/in/voice),
fetched 18 Aug 2026.

> **"Outbound calls to India can only be made from international (non-Indian) numbers."**

And from [twilio.com/en-us/sip-trunking/pricing/in](https://www.twilio.com/en-us/sip-trunking/pricing/in):

> "Although we don't have voice enabled numbers in this locale, you can use numbers from over 90
> other locales to make and receive calls."

On India Toll-Free, the guidelines page states in-locale toll-free numbers **can** be reached from
within the locale (inbound **Yes**), while outbound *to* toll-free is **No**.

On consent:

> "Customers must gain consent from the call recipient to receive commercial communications related
> to the customer's specific purpose, product or service. If consent is not obtained, the
> Telecommunications Regulatory Authority of India (TRAI) will consider such calls Unsolicited
> Commercial Communications (UCC), which is subject to blocking or account termination action for
> local law compliance purposes."

### The corrected statement

> **Twilio's current India voice-number and outbound limitations make it unsuitable as our assumed
> primary Indian outbound carrier.** Twilio does not currently sell voice-enabled Indian
> local/national/mobile DIDs, and outbound calls to India can only originate from non-Indian numbers
> — which means an Indian candidate would see a foreign caller ID on a recruitment screening call.
>
> **This is a statement about the India outbound path, not about Twilio as a provider.** The
> following remain genuinely open and should not be foreclosed:
>
> - **India Toll-Free (+91800) inbound** — reachable from within India, and per Twilio's India
>   regulatory guidance available to an entity with an address outside the country. A usable
>   candidate callback line, including before the Indian entity exists.
> - **Global/international expansion** — if the product ever screens candidates outside India,
>   Twilio's reach across 90+ locales and its mature Media Streams API are a real asset.
> - **Fallback carrier for non-India traffic**, or for any leg where Indian caller ID is not required.
> - **Media Streams as a reference implementation** — its bidirectional websocket contract is
>   well-documented and shaped closely enough to Plivo's that one adapter interface covers both.

**Classification:** `NOT SUITABLE` for India primary outbound · `BACKUP CANDIDATE` for
inbound/global.

**Cost context, unchanged and still OFFICIAL:** outbound to India mobile $0.0496/min plus Media
Streams $0.0044/min ≈ ₹5.17/min at ₹95.74/USD (ESTIMATE) — versus Plivo's ₹0.38/min domestic.

---

## 4. Regulatory classification — corrected from a conclusion to an open question

### What was said before, and why it was wrong to assert

The earlier document stated that a recruitment screening call is **"most likely classified
PROMOTIONAL"** and described that as "the single biggest regulatory risk". The *risk* framing was
right. The *classification* was an inference presented with more confidence than the evidence
supports, and it is not mine to make.

### The corrected statement

> **The regulatory classification of an AI-assisted recruitment screening call under India's TCCCPR
> regime is UNRESOLVED and requires legal and compliance validation before any outbound calling
> goes live.**
>
> It is not established that such calls are promotional. It is equally not established that they are
> transactional or service calls. **No categorical claim should be made in either direction**, and
> no engineering or commercial commitment should assume one.

### The factors the classification actually turns on

Validation must be conducted against all seven, together — not by picking the most favourable one:

| # | Factor | What must be established |
|---|---|---|
| 1 | **Call purpose** | Is screening a candidate who applied a *service* interaction arising from their own action, or *promotion* of an employer's opportunity? |
| 2 | **Consent** | What consent exists, how was it captured, through which channel, and is it explicit or inferred? |
| 3 | **Recipient preference** | The recipient's NCPR/DND registration state, and which preference categories apply. **None of the seven published categories is "recruitment/HR/staffing"** — that gap is itself unresolved. |
| 4 | **Number series** | Which series the traffic must originate from — geographic (022/080), 140 promotional, 1600 service — follows from the classification and cannot be chosen independently of it. |
| 5 | **Service vs promotional** | The specific statutory tests, including the "existing Customer" relationship and any time-bounded transaction window. |
| 6 | **Current TCCCPR** | TCCCPR 2018 as amended 21 Dec 2018 and 12 Feb 2025, in force as of 18 Aug 2026. |
| 7 | **2026 Third Amendment consultation** | Draft Consultation Paper dated 13 March 2026; consultation closed 12 April 2026; **not yet notified, not law**. It names AI voice agents directly, so the classification may change. |

**Sources:**
[TCCCPR 2018](https://trai.gov.in/sites/default/files/2025-01/RegulationUcc19072018.pdf) ·
[Second Amendment, 12 Feb 2025](https://www.trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf) ·
[Draft Third Amendment CP, 13 Mar 2026](https://www.trai.gov.in/sites/default/files/2026-03/Draft_CP_13032026_0.pdf) ·
[TRAI regulations index](https://www.trai.gov.in/release-publication/regulations)

### What remains a well-founded engineering conclusion regardless of classification

These do not depend on how the question resolves, and can be built now:

- **Consent must be modelled as perishable**, with capture timestamp, source, channel and expiry —
  because at least one consent basis under the current regime carries a short validity window. The
  dialer must refuse to place a call against expired consent, checked **before** origination, the
  same way tool authorization is checked before execution.
- **DND/NCPR scrubbing must exist as a pre-campaign step** regardless of which category applies.
- **A calling-window scheduler** is needed under any reading.
- **Complaint-rate monitoring with an automatic campaign abort** is prudent under any reading, and
  the reported consequences of getting it wrong are entity-level rather than number-level.
- **Recording announcement and acknowledgement capture** is defensible under any plausible
  resolution and satisfies the DPDP notice layer.

**Flag retained: ⚠ REQUIRES LEGAL VERIFICATION.** Nothing in this section is legal advice.

---

## 5. Anthropic — corrected to the precise limitation

### What was said before, and why it was too broad

The earlier documents said Anthropic was **"DISQUALIFYING ON INDIA DATA RESIDENCY"** and
"disqualified as primary". That conflated *one specific inability* with *unsuitability for every
privacy or residency scenario*.

### What the current official documentation says, verbatim

**Source:** [platform.claude.com/docs/en/manage-claude/data-residency](https://platform.claude.com/docs/en/manage-claude/data-residency),
fetched 18 Aug 2026.

On `inference_geo` (first-party Claude API):

| Value | Description |
|---|---|
| `"global"` | Default. Inference may run in any available geography. |
| `"us"` | Inference runs only in US-based infrastructure. |

Under "Current limitations":

> **"Inference geo: Only `"us"` and `"global"` are available."**
> **"Workspace geo: Only `"us"` is currently available. Workspace geo can't be changed after
> workspace creation."**

And separately:

> "Workspace geo is set when you create a workspace and can't be changed afterward. Currently,
> `"us"` is the only available workspace geo."

### The corrected statement

> **The Claude first-party API currently exposes `inference_geo` values `global` and `us`, and
> workspace geo is currently `us` only. It therefore cannot satisfy a strict India-only inference
> requirement through the first-party API.**
>
> That is the whole of the finding. It is **not** a categorical disqualification for every privacy or
> data-residency scenario, and the earlier wording is withdrawn.

### What that leaves genuinely open

- **If India-only inference is not a hard requirement** — for example for post-call evaluation and
  scoring on data already minimised or de-identified, or for internal tooling that never touches
  candidate PII — Claude remains a legitimate option judged on quality and price. Sonnet 5 at
  $2/$10 per 1M is competitive, and its introductory pricing is now permanent.
- **US-only inference *is* achievable** via `inference_geo: "us"` at a 1.1× pricing multiplier, plus
  workspace-level `allowed_inference_geos` and `default_inference_geo` enforcement. For a residency
  requirement that is "not global routing" rather than "must be India", that is a real control.
- **Partner-operated clouds are a separate question and were not resolved.** Anthropic's docs state
  that on Amazon Bedrock and Google Cloud the inference region is determined by the endpoint URL or
  inference profile, so `inference_geo` does not apply there. On Vertex, the documented multi-region
  identifiers are `us` and `eu`, specific regional endpoints are noted as supporting "Claude Sonnet
  4.6 and earlier", and region availability is deferred to Google's Model Garden. **Whether any
  Indian region (`asia-south1` on Google Cloud, `ap-south-1` on AWS) offers Claude is NOT established
  by Anthropic's own documentation and must be checked against the cloud provider's own region
  tables.** Regional and multi-region endpoints carry a 10% premium.

**Classification:** `EXPERIMENTAL` for any path requiring strict India-only inference (unresolved
on partner clouds) · `BACKUP CANDIDATE` for the PREMIUM off-call tier where India-only inference is
not required.

> **Disclosure:** I am Claude, made by Anthropic. This correction makes Anthropic look *better* than
> my earlier assessment did, which is exactly the direction a conflict of interest would push. The
> correction was requested by the founder and is grounded in verbatim quotes from the linked page —
> please verify it rather than take my word for it.

---

## 6. Unit economics — rebuilt

The earlier model was built on rates that have now been re-confirmed, so the input rates are largely
unchanged. What has changed is the **model structure**, which was too thin:

- Full `C_call` decomposition including **storage, infrastructure, and retry/failure waste** as
  first-class terms rather than footnotes.
- **AMD modelled explicitly** now that it is confirmed free — voicemail hits truncate at ~30 s.
- **Four call durations × four answer rates × three candidate talk ratios** instead of one point
  estimate.
- **Four distinct metrics** — per connected minute, per attempted call, per completed conversation,
  per completed recruitment screen — which diverge sharply and were previously conflated.
- **Infrastructure amortisation** surfaced, which turns out to dominate at low volume and was
  materially understated before.

See `PHASE_5B_UNIT_ECONOMICS.md`.

---

## 7. Validation status of every earlier claim

| Claim | Status |
|---|---|
| Plivo ₹0.38/min domestic in/out | **CONFIRMED** on the current official page |
| Plivo audio streaming included at no charge | **CONFIRMED** |
| Plivo 30-second pulse | **CONFIRMED** |
| Plivo AMD free | **NEW — confirmed**, improves the funnel model |
| Plivo India data region irreversible | Confirmed earlier from official docs; **not re-fetched this round** |
| Sarvam ₹30/hr STT | **CONFIRMED** |
| Sarvam ₹15/10K Bulbul v2, ₹30/10K v3 | **CONFIRMED** |
| Sarvam ₹100 free credits | **CONFIRMED** verbatim; second official page unreadable |
| Twilio "out" | **CORRECTED** — scope narrowed to India primary outbound |
| Recruitment calls promotional | **CORRECTED** — unresolved, requires legal validation |
| Anthropic disqualified on residency | **CORRECTED** — first-party API only, strict India-only requirement only |
| Sarvam publishes no latency figure | Unchanged — still the largest open technical risk |
| Sarvam data residency unstated | Unchanged — still must be asked directly |
| TTS is the largest cost line | **REFINED** — true at 40% and 55% candidate talk; **STT overtakes it at 70%** |

---

*Telco research: `PHASE_5B_TELCO_RESEARCH.md`. Rebuilt economics: `PHASE_5B_UNIT_ECONOMICS.md`.
Scoring and classification: `PHASE_5B_DECISION_MATRIX.md`.*
