# Phase 5B — Unit Economics, Rebuilt

Rebuilt from current official pricing, re-verified 18 August 2026. Supersedes
`PHASE_5_UNIT_ECONOMICS.md`.

**FX:** ₹95.74/USD (THIRD_PARTY, 18 Aug 2026). Every conversion is an **ESTIMATE**.
All INR-native rates (Plivo, Sarvam, TTBS, Knowlarity) carry no FX exposure.

---

## 1. The cost equation

```
C_call = telephony + STT + TTS + LLM + storage + infrastructure + retries/failures
```

Every term is now modelled explicitly. The earlier model treated storage and infrastructure as
footnotes and folded retries into a single funnel assumption — both turned out to matter more than
that treatment implied.

### Input rates — all OFFICIAL, re-verified this round

| Component | Rate | Source |
|---|---|---|
| Telephony | ₹0.38/min, **30-second pulse** | [Plivo India pricing](https://www.plivo.com/voice/pricing/in/) |
| Number rental | ₹200/month | same |
| **Answering machine detection** | **₹0.00/min** | same — **new this round** |
| Call recording | ₹0.00/min | same |
| STT | ₹30/hour = ₹0.50/min | [Sarvam pricing](https://docs.sarvam.ai/api-reference-docs/pricing) |
| TTS (Bulbul v2) | ₹15 / 10K characters | same |
| LLM (Sarvam 105B) | ₹29.28 in / ₹10.98 cached / ₹73.2 out per 1M | same |
| Storage | $0.015/GB-month, free egress | [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/) |
| Infrastructure | $24 Droplet + ~$1 R2 = ₹2,394/month | DigitalOcean BLR1 |

### Assumptions — stated, and these are what to replace with measured data

| Assumption | Value |
|---|---|
| Speech rate | 850 characters/minute |
| Conversational turns | 3 per minute |
| LLM tokens per turn | 2,000 in / 120 out, 70% cache hit |
| Recording size | 0.48 MB/min (μ-law 8 kHz mono), 12-month retention |
| Voicemail share of answered calls | 20% |
| **Voicemail duration** | **30 s — AMD truncates it** (free, per above) |
| Early-drop share of live conversations | 25%, reaching 35% of target duration |
| Completed conversations yielding a usable screen | 90% |
| GST | 18% |

---

## 2. Per-minute build-up, by candidate talk ratio

The candidate talk ratio is the inverse of agent talk, and it drives TTS directly.

| Candidate talks | Agent talks | Telephony | STT | TTS | LLM | Storage | **Total ₹/min** |
|---|---|---|---|---|---|---|---|
| 40% | 60% | 0.380 | 0.500 | **0.765** | 0.125 | 0.008 | **1.778** |
| 55% | 45% | 0.380 | 0.500 | **0.574** | 0.125 | 0.008 | **1.587** |
| 70% | 30% | 0.380 | **0.500** | 0.383 | 0.125 | 0.008 | **1.396** |

**A talkative candidate is a cheaper candidate** — the span is 27% between the extremes. STT bills
the whole call regardless of who is speaking; TTS bills only the agent. Designing an agent that asks
short questions and listens is both better screening practice and materially cheaper.

---

## 3. Which component dominates

| Candidate talk | Dominant | Full ordering (share of variable cost) |
|---|---|---|
| **40%** | **TTS** | TTS 42.6% · STT 27.8% · telephony 22.1% · LLM 7.0% · storage 0.5% |
| **55%** | **TTS** | TTS 35.8% · STT 31.2% · telephony 24.7% · LLM 7.8% · storage 0.5% |
| **70%** | **STT** | STT 35.4% · telephony 28.1% · TTS 27.1% · LLM 8.9% · storage 0.6% |

**There is a genuine crossover.** TTS dominates when the agent talks more; **STT overtakes it around
a 70% candidate talk ratio**. The Phase 5 document asserted TTS dominance flatly — that was true only
for the talk ratio it happened to assume.

**The LLM never exceeds 9% under any scenario modelled.** Optimising it is not where the money is.

**Speech (STT + TTS) is 62–70% of variable cost in every scenario.** That is the layer to benchmark
and negotiate.

---

## 4. The four requested metrics

Candidate talk 55%, 1,000 attempted calls/month, lean infrastructure, **including 18% GST**.

| Duration | Answer rate | ₹/connected min | ₹/attempted call | ₹/completed conversation | ₹/completed screen |
|---|---|---|---|---|---|
| **2 min** | 30% | 8.88 | 3.83 | 21.31 | **23.67** |
| | 50% | 6.04 | 4.35 | 14.50 | **16.12** |
| | 70% | 4.83 | 4.87 | 11.59 | **12.88** |
| | 85% | 4.29 | 5.26 | 10.30 | **11.45** |
| **5 min** | 30% | 4.79 | 4.96 | 27.57 | **30.63** |
| | 50% | 3.61 | 6.23 | 20.77 | **23.08** |
| | 70% | 3.11 | 7.50 | 17.86 | **19.84** |
| | 85% | 2.88 | 8.45 | 16.57 | **18.41** |
| **8 min** | 30% | 3.72 | 6.09 | 33.84 | **37.60** |
| | 50% | 2.97 | 8.11 | 27.04 | **30.04** |
| | 70% | 2.65 | 10.13 | 24.12 | **26.80** |
| | 85% | 2.51 | 11.65 | 22.84 | **25.37** |
| **12 min** | 30% | 3.11 | 7.60 | 42.22 | **46.91** |
| | 50% | 2.61 | 10.62 | 35.42 | **39.35** |
| | 70% | 2.40 | 13.65 | 32.50 | **36.11** |
| | 85% | 2.30 | 15.92 | 31.22 | **34.68** |

### Reading this table

**The four metrics move in opposite directions, which is why conflating them misleads.**

- **Cost per connected minute falls** as answer rate rises — fixed costs spread over more minutes.
- **Cost per attempted call rises** as answer rate rises — more attempts actually connect and incur
  AI cost. A 2-minute screen costs ₹3.83 per attempt at 30% answer and ₹5.26 at 85%.
- **Cost per completed screen falls sharply** with answer rate — from ₹30.63 to ₹18.41 for a 5-minute
  screen, a **40% reduction**.

**Improving answer rate is the highest-leverage commercial lever available**, and it is not a
provider decision. It is caller ID quality, time-of-day targeting, consent freshness, and whether the
number looks local. That is product work, not procurement.

---

## 5. Full matrix — cost per completed recruitment screen (₹, incl. GST)

| Duration | Candidate talk | 30% | 50% | 70% | 85% | Dominant |
|---|---|---|---|---|---|---|
| 2 min | 40% | 24.23 | 16.68 | 13.44 | 12.01 | TTS |
| 2 min | 55% | 23.67 | 16.12 | 12.88 | 11.45 | TTS |
| 2 min | 70% | 23.11 | 15.56 | 12.32 | 10.89 | **STT** |
| 5 min | 40% | 32.03 | 24.48 | 21.24 | 19.81 | TTS |
| 5 min | 55% | 30.63 | 23.08 | 19.84 | 18.41 | TTS |
| 5 min | 70% | 29.23 | 21.68 | 18.44 | 17.01 | **STT** |
| 8 min | 40% | 39.84 | 32.28 | 29.04 | 27.61 | TTS |
| 8 min | 55% | 37.60 | 30.04 | 26.80 | 25.37 | TTS |
| 8 min | 70% | 35.36 | 27.80 | 24.56 | 23.13 | **STT** |
| 12 min | 40% | 50.27 | 42.71 | 39.47 | 38.04 | TTS |
| 12 min | 55% | 46.91 | 39.35 | 36.11 | 34.68 | TTS |
| 12 min | 70% | 43.55 | 35.99 | 32.75 | 31.32 | **STT** |

**Range across the whole matrix: ₹10.89 to ₹50.27 per completed screen** — a **4.6× spread** driven
entirely by variables that are not provider prices. Any single headline number for "cost per screen"
is close to meaningless without stating duration, answer rate and talk ratio alongside it.

---

## 6. Infrastructure amortisation — the finding the earlier model buried

5-minute screen, 50% answer rate, 55% candidate talk, lean infrastructure (₹2,594/month fixed):

| Calls/month | Infra ₹/screen | Total ₹/screen | **Infra share of total** |
|---|---|---|---|
| 100 | 113.35 | 125.09 | **90.6%** |
| 250 | 45.34 | 57.08 | **79.4%** |
| 500 | 22.67 | 34.41 | 65.9% |
| 1,000 | 11.33 | 23.08 | 49.1% |
| 2,500 | 4.53 | 16.28 | 27.9% |
| 5,000 | 2.27 | 14.01 | 16.2% |

> **At pilot volumes, this is not a provider-cost business — it is a fixed-cost business.** At 100
> calls/month, **90.6% of the cost per screen is infrastructure**, and provider rates are almost
> irrelevant. Infrastructure does not fall below half the cost until roughly 1,000 calls/month.

**Three consequences:**

1. **Do not optimise provider rates at pilot scale.** Choosing Sarvam over Deepgram changes a number
   that is 9% of the total. Running on a smaller Droplet, or deferring managed Postgres, changes the
   number that is 90%.
2. **Early pricing must not be built on marginal cost.** At 100 calls/month the true cost per screen
   is ₹125, not ₹14. Pricing a pilot customer off the ₹14 figure loses money on every screen.
3. **Volume is the lever, not procurement.** Getting from 100 to 1,000 calls/month cuts cost per
   screen by 82% without changing a single vendor.

---

## 7. Retries and failure waste

Modelled explicitly as a term in `C_call`, with AMD now confirmed free.

At every answer rate, wasted minutes (voicemail + early drops) are **13.0% of connected minutes**.
The share is stable because voicemail and drop rates are modelled as proportions *of answered calls*,
not of attempts.

**AMD materially improves this.** Without it, a voicemail hit would run the full call length — at a
5-minute target that is 10× the modelled 30 seconds, and the waste share would rise from 13% to
roughly 40% of connected minutes. **Plivo publishing AMD at ₹0.00/min is worth more than any
per-minute rate difference in this research.**

**Unmodelled failure modes**, flagged rather than guessed: provider retries after a transient failure
(bounded at 2 by the runtime, so at most 3× LLM cost on an affected turn); carrier-side call setup
failures; and calls that connect but fail language detection. All need measurement.

---

## 8. Telephony alternatives at the same volumes

Using the Phase 5B telco research. Break-even for TTBS assumes 12-month amortisation of the ₹20,000
setup fee.

| Minutes/month | Plivo (₹0.38 + ₹200) | TTBS Voice Streaming | Knowlarity C2C (₹0.40 + Advance number) |
|---|---|---|---|
| 500 | **₹390** | ₹2,767 | ₹1,600 |
| 1,000 | **₹580** | ₹2,767 | ₹1,800 |
| 2,500 | **₹1,150** | ₹2,767 | ₹2,400 |
| 5,000 | **₹2,100** | ₹2,767 | ₹3,400 |

**Plivo is cheapest at every volume up to the TTBS 5,000-minute fair-use ceiling.** TTBS only becomes
competitive above that, where a second concurrency is required and the comparison resets.

**Conclusion:** TTBS is worth having as a licensed-carrier second source and for compliance posture.
It is **not** a cost optimisation at bootstrap scale, and should not be chosen as one.

---

## 9. The ₹10,000/month budget

Lean infrastructure (₹2,594/month + ₹200 number, ₹3,060 including GST). Marginal cost excludes
infrastructure, which is already covered by the fixed line.

| Screen length | Marginal ₹/screen | **Screens/month within ₹10,000** |
|---|---|---|
| 2 min | 4.78 | **~1,451** |
| 5 min | 11.74 | **~591** |
| 8 min | 18.71 | **~371** |
| 12 min | 28.02 | **~248** |

At 50% answer rate and 55% candidate talk.

**The screen length you design is the single biggest determinant of how much pilot you can afford** —
a 2-minute screen buys nearly 6× the volume of a 12-minute one. That is a product-design decision
with a direct budget consequence, and it should be made deliberately rather than by default.

---

## 10. Gross margin at HYPOTHETICAL prices

> **Illustrative arithmetic only. Not a pricing decision.** The brief says not to finalise pricing.

5-minute screens, 50% answer, 55% talk, marginal cost ₹11.74/screen incl. GST:

| Plan (HYPOTHETICAL) | Screens included | Price/month | Marginal cost | Gross | Margin |
|---|---|---|---|---|---|
| Starter | 100 | ₹4,999 | ₹1,174 | ₹3,825 | **76.5%** |
| Growth | 400 | ₹14,999 | ₹4,696 | ₹10,303 | **68.7%** |
| Scale | 1,200 | ₹39,999 | ₹14,088 | ₹25,911 | **64.8%** |
| Volume | 3,000 | ₹89,999 | ₹35,220 | ₹54,779 | **60.9%** |

**Excludes shared infrastructure**, which is the dominant cost until roughly 1,000 calls/month
across all customers combined.

**Overage floor:** one extra 5-minute screen costs **₹11.74** including GST. Any overage price below
that loses money. Price overage against *completed screens*, not minutes — the customer is buying
screened candidates, and it aligns the platform's incentive with improving answer rate.

---

## 11. What is uncertain, honestly

**Confident:** the arithmetic, and every OFFICIAL rate feeding it — all re-verified 18 Aug 2026.

**Genuinely uncertain, in order of impact:**

1. **Answer rate.** Drives a 40% swing in cost per screen and is the least knowable input. Everything
   else is second-order.
2. **Call volume**, because of the infrastructure dominance above. The difference between 100 and
   1,000 calls/month is larger than every provider choice combined.
3. **Turn count and token estimates** — derived from plausible conversation shape, not measurement.
4. **The 20% voicemail / 25% drop / 90% usable assumptions** — plausible, unmeasured.
5. **GST treatment.** Assumed 18% throughout; Plivo's India page still says nothing about tax.
6. **Concurrency ceilings.** Unpublished by Plivo. A screening campaign is concurrency-bound, and a
   low ceiling would cap the product well below what the minute budget suggests.

**What would most change the conclusions:** if Sarvam's unpublished latency proves unusable and TTS
moves to Cartesia (₹2.81/min vs ₹0.57/min), variable cost rises ~2.4×. At 5-minute screens that takes
marginal cost from ₹11.74 to roughly ₹28/screen, and the ₹10,000 budget from ~591 screens to ~248.
The business still works; the pilot gets smaller.

---

*Provider corrections: `PHASE_5B_PROVIDER_VALIDATION.md`. Telco research:
`PHASE_5B_TELCO_RESEARCH.md`. Scoring and classification: `PHASE_5B_DECISION_MATRIX.md`.*
