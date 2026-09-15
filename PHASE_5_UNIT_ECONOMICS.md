# Phase 5 Pre-Implementation — Unit Economics

Built entirely from the OFFICIAL rates in `PHASE_5_PROVIDER_RESEARCH.md`. Every assumption is stated
and labelled. No revenue figure appears without being marked **HYPOTHETICAL**.

FX: **₹95.74/USD** (ESTIMATE, 18 Aug 2026). All conversions inherit that uncertainty.

---

## 1. Assumptions — stated, not buried

These are the numbers that drive everything below. They are **assumptions, not measurements**, and
they are the first things to replace with real data from the pilot.

| Assumption | Value | Basis |
|---|---|---|
| Screening call length | 4 minutes | ASSUMPTION — typical first-round phone screen |
| Speech rate | 850 chars/min | ASSUMPTION — ~150 wpm English |
| Agent share of talk time | 45% | ASSUMPTION — agent asks, candidate answers at length |
| Conversational turns | 3 per minute | ASSUMPTION |
| LLM input per turn | 2,000 tokens | ASSUMPTION — system + agent instructions + retrieved knowledge + history |
| LLM output per turn | 120 tokens | ASSUMPTION — one spoken sentence or two |
| Prompt-cache hit rate | 70% | ASSUMPTION — system prompt and knowledge are stable within a call |
| GST on Indian telecom/SaaS | 18% | THIRD_PARTY — Exotel's page states "*GST applicable"; Plivo's India page is silent |

**On GST:** every INR figure below is understated by 18% unless the provider invoice proves
otherwise. A ₹10,000/month budget is therefore ~₹8,475 of actual service. If the entity is
GST-registered, input tax credit brings the effective cost back down — which is another reason the
Indian entity question is load-bearing rather than administrative.

---

## 2. Cost per conversation-minute — recommended stack

Plivo India + Sarvam STT + Sarvam TTS + Sarvam 105B, all INR-native.

| Component | Rate (OFFICIAL) | ₹/min | Share |
|---|---|---|---|
| Telephony — Plivo India domestic | ₹0.38/min | **0.3800** | 24.1% |
| STT — Sarvam Saaras | ₹30/hour | **0.5000** | 31.7% |
| TTS — Sarvam Bulbul v2 | ₹15/10K chars | **0.5737** | 36.3% |
| LLM — Sarvam 105B (70% cached) | ₹29.28 / ₹10.98 / ₹73.2 per 1M | **0.1252** | 7.9% |
| Embeddings — retrieval query | $0.02/1M | 0.0003 | 0.0% |
| **Total** | | **₹1.5792/min** | |

### The finding that should change how you think about this

**The phone call is not the expensive part. Speech is.**

At Indian domestic rates, telephony is only **24%** of the cost. **TTS alone is 36%** — the single
largest line — and STT and TTS together are **68%**. The LLM, which absorbs most of the attention in
this category, is **under 8%**.

Two consequences follow directly:

1. **Optimising the LLM is nearly pointless here.** Moving from Sarvam 105B to `gpt-5.6-luna`
   actually *reduces* total cost by 3% (₹1.538/min) — a rounding error. Choose the LLM on tool-calling
   reliability, latency and India posture, because cost barely moves.
2. **Agent verbosity is a cost lever with real teeth.** If the agent talks 70% of the time instead of
   45%, total cost rises 20% to ₹1.898/min. A concise agent is a cheaper agent, and it is also a
   better screening experience. That is a rare alignment — take it.

### Alternative stacks, same assumptions

| Stack | ₹/min | vs recommended |
|---|---|---|
| **Recommended** (Plivo + Sarvam ×3) | **1.58** | — |
| Plivo + Deepgram + Cartesia + Gemini Flash-Lite | 3.70 | **2.3×** |
| Plivo + Sarvam + Smallest.ai + Sarvam | 9.63 | 6.1× |
| **Twilio international** + Deepgram + Cartesia + Gemini | 8.49 | 5.4× — *and the caller ID is foreign, so it does not work* |

**The cost of getting telephony wrong:** Twilio's call-plus-media path is ₹5.17/min against Plivo's
₹0.38/min — **13.6×**, and more than three times the entire recommended stack by itself.

---

## 3. Cost per call

Variable provider cost, excluding GST:

| Duration | Cost |
|---|---|
| 1 min | ₹1.58 |
| 2 min | ₹3.16 |
| **4 min (assumed screen)** | **₹6.32** |
| 6 min | ₹9.48 |
| 10 min | ₹15.79 |

---

## 4. Cost per *completed screen* — the number that actually matters

Cost per minute flatters the business. Outbound recruitment dialing does not convert every attempt,
and you pay for the failures.

**Funnel (ASSUMPTION — replace with measured data from the pilot):**

```
100 dial attempts
  →  35 answered            (35% answer rate)
       →   8 voicemail      (~30s each, billed)
       →   7 dropped early  (~1 min each)
       →  20 completed 4-minute screens
```

Billed conversation minutes: `8×0.5 + 7×1 + 20×4` = **91 minutes** for **20 completed screens**
= **4.55 billed minutes per completed screen**, against 4 minutes of actual conversation.

| | Value |
|---|---|
| Variable provider cost for the batch | ₹143.71 |
| **Per completed screen** | **₹7.19** |
| **Per completed screen, incl. 18% GST** | **₹8.48** |

**That is the figure to commit against — not ₹1.58/min, and not ₹6.32/call.** It is 34% higher than
the naive per-call number, and the gap is entirely answer-rate and voicemail waste.

Plivo's **30-second billing pulse** means short calls round up, which is already reflected above.

**Not yet modelled, and it should be before launch:** answering-machine detection. Without AMD the
agent delivers a full screening interview to a voicemail greeting and you pay for every second.
Twilio prices AMD separately; nobody has asked Plivo or Exotel what they offer, what the
false-positive rate is, or how many seconds of detection delay AMD adds to the front of every
legitimate call (typically 1–4 s, which is a poor first impression).

---

## 5. Monthly scenarios

Recommended stack, one phone number, lean infrastructure (self-managed Postgres on a DigitalOcean
BLR1 Droplet + Cloudflare R2).

Fixed: Droplet 2 vCPU/4 GiB **$24/mo** + R2 ~**$1/mo** = ₹2,394 (ESTIMATE) · number **₹200/mo**.

| Conversation min/mo | Variable | + number | + infra | **incl. 18% GST** | Effective ₹/min |
|---|---|---|---|---|---|
| 100 | ₹158 | ₹358 | ₹2,751 | **₹3,247** | ₹32.47 |
| 500 | ₹790 | ₹990 | ₹3,383 | **₹3,992** | ₹7.98 |
| 1,000 | ₹1,579 | ₹1,779 | ₹4,173 | **₹4,924** | ₹4.92 |
| 5,000 | ₹7,896 | ₹8,096 | ₹10,490 | **₹12,378** | ₹2.48 |
| 10,000 | ₹15,792 | ₹15,992 | ₹18,386 | **₹21,695** | ₹2.17 |

With **fully managed** infrastructure (DO Managed Postgres $15.15 + Managed Valkey $15), fixed cost
rises from ₹2,594 to ₹5,480/month before GST — which matters enormously at low volume and barely at
all at high volume.

**Recording storage is negligible** and can be ignored in planning: at 10,000 min/month with
12-month retention, R2 steady-state is ~56 GB ≈ **₹81/month**.

---

## 6. The ₹10,000/month bootstrap constraint

The brief is explicit that the goal is not to force customers into a ₹10,000 budget, but to
understand what the platform costs and where limits are needed. Here is the answer.

### What the platform itself costs at zero usage

| Posture | Monthly fixed (incl. GST) |
|---|---|
| **Lean** — one BLR1 Droplet, self-managed Postgres + Redis, R2, one number | **₹3,060** |
| **Managed** — Droplet + DO Managed Postgres + Managed Valkey, R2, one number | **₹6,466** |

### How much provider usage the remaining budget buys

| Posture | Headroom | Conversation min/mo | ≈ Completed screens/mo |
|---|---|---|---|
| **Lean** | ₹6,940 | **~3,724 min** | **~818** |
| **Managed** | ₹3,534 | ~1,896 min | ~417 |

**Start lean.** Self-managing Postgres and Redis on the Droplet roughly **doubles** the usage the
budget supports — 818 completed screens a month versus 417. At this stage that difference is the
difference between a real pilot and a demo. Move to managed Postgres when either the backup story or
the operational load justifies it, not before.

**Headline:** the ₹10,000/month budget supports roughly **800 completed candidate screens per
month** on the recommended stack. That is a genuine pilot, not a toy.

### One-time costs before the first call

| Item | Cost | Lead time | Source |
|---|---|---|---|
| Indian entity (Pvt Ltd) | ~₹15,000–25,000 | 2–4 weeks | THIRD_PARTY |
| *(Udyam/MSME alternative)* | *materially cheaper* | *faster* | THIRD_PARTY — **investigate first** |
| GST registration | varies | — | — |
| Plivo KYC | ₹0 | 15 min – 1 business day | OFFICIAL |
| DLT Principal Entity registration | ~₹5,900 one-time | 5–10 business days | THIRD_PARTY |
| Header/series approval | — | unknown | NOT_PUBLISHED |

**Realistic time-to-first-call: 6–10 weeks.** That belongs at the top of any Phase 5 plan, above
every per-minute rate. None of it is engineering work, and none of it can be compressed by writing
code faster.

---

## 7. Sensitivity — what actually moves the number

| Change from baseline | ₹/min | Multiple |
|---|---|---|
| **Baseline** | 1.579 | 1.00× |
| LLM → `gpt-5.6-luna` | 1.538 | **0.97×** *(cheaper)* |
| 6 turns/min instead of 3 | 1.704 | 1.08× |
| Agent talks 70% instead of 45% | 1.898 | 1.20× |
| STT → Azure Central India | 2.675 | 1.69× |
| TTS → Cartesia Sonic | 3.820 | **2.42×** |

**TTS choice is the dominant cost decision in this stack** — a 2.4× swing, larger than any other
single change. If the Sarvam latency benchmark fails and you must move to Cartesia for
responsiveness, the model changes materially and the pricing must change with it. **Benchmark Sarvam
TTS latency before committing to any customer-facing price.**

---

## 8. Gross margin at HYPOTHETICAL prices

> **These prices are illustrative arithmetic, not a pricing decision.** The brief explicitly says not
> to finalise pricing. They exist only to show whether the unit economics can work at all.

Assuming the recommended stack, lean infrastructure, and included-minute allowances:

| Plan (HYPOTHETICAL) | Included min/mo | Price/mo | Provider cost (incl GST) | Gross | Margin |
|---|---|---|---|---|---|
| Starter | 500 | ₹4,999 | ₹1,168 | ₹3,831 | **76.6%** |
| Growth | 2,000 | ₹14,999 | ₹3,963 | ₹11,036 | **73.6%** |
| Scale | 6,000 | ₹39,999 | ₹11,417 | ₹28,582 | **71.5%** |
| Volume | 15,000 | ₹89,999 | ₹28,188 | ₹61,811 | **68.7%** |

*(Excludes platform infrastructure, which is shared across all customers and amortises rapidly.)*

**The economics work.** ~70% gross margin at software-like levels, with margin compressing gently
as usage grows — the normal shape for a usage-backed SaaS product, and healthy.

**The floor that must never be crossed:** one extra conversation-minute costs **₹1.86 including GST**.
Any overage price below that loses money on every marginal minute. Given answer-rate waste, an
overage price should be set against the **cost per completed screen (₹8.48)**, not the per-minute cost.

---

## 9. What must be metered — and where the limit is enforced

Phase 4 already established the discipline: **check before the action, never after.** The same rule
applies to spend, and `06_PROVIDER_AND_COST_SPEC` §12 already requires it. The cost model tells us
exactly which dimensions carry the risk.

| Dimension | Why it must be metered | Enforcement point |
|---|---|---|
| **Conversation minutes** | 68% of variable cost is speech, billed by the second | Before call origination |
| **Concurrent calls** | **The real capacity constraint** — a screening campaign is concurrency-bound, not minute-bound. 20 simultaneous screens is a completely different product from 2. Plivo's ceiling per DID is **not published**. | Before call origination |
| **Maximum call duration** | Server-side timer, independent of provider | Already specified in §12 |
| **Daily call and spend caps** | Per organization and platform-wide | Before origination |
| **TTS characters** | Largest single cost line; a verbose agent is expensive | Per turn, inside the runtime loop |
| **LLM tokens** | Small cost but unbounded growth risk | Already bounded — Phase 4 `maxContextChars`, `maxHistoryMessages` |
| **Complaint rate** | **The existential one.** DLT blacklisting is reported to be entity-level. | Per campaign, with automatic abort |
| **Consent validity** | 7-day expiry under TCCCPR | Before origination — refuse on expired consent |
| **Calling window** | 09:00–21:00 restriction | Scheduler, before origination |

**Three of these — complaint rate, consent expiry, and calling window — are regulatory, not
financial, and none of them exists in the platform today.** They belong in Phase 5 alongside the
voice path, and they gate origination exactly the way tool authorization gates execution.

**Not yet bounded anywhere:** per-organization *aggregate* spend. Phase 4's limits bound a single
conversation; nothing bounds an organization's monthly total. On this budget, one runaway integration
is the difference between a bill and a crisis.

---

## 10. Recommended pricing dimensions

The brief asks for the economically sensible dimensions, not final prices. From the cost structure
above:

**Price on these — they track cost:**

1. **Included conversation minutes** — 68% of variable cost is speech, and minutes are what the
   customer intuitively understands.
2. **Concurrent call capacity** — the real capacity constraint, and a genuine product differentiator
   between a recruiter doing 2 screens at a time and an agency doing 20.
3. **Intelligence tier** — already modelled, already abstract, and it maps to a real cost difference
   at the ADVANCED and PREMIUM tiers.
4. **Voice tier** — TTS is the largest cost line, so premium voice genuinely costs more. This is the
   most defensible upsell in the stack.
5. **Number of agents** — a proxy for organizational scope, near-zero marginal cost, so it is a
   packaging lever rather than a cost-recovery one.

**Do not price on these:**

- **Per user/seat** — explicitly ruled out by the brief, and correct: cost is driven by calls, not by
  how many recruiters watch the dashboard. Seat pricing would also punish exactly the team-wide
  adoption the product needs.
- **Knowledge capacity** — embeddings are under 0.1% of cost. Use it as a plan-differentiator if
  useful, never as a cost-recovery dimension.
- **Per API call / per token** — leaks infrastructure into the commercial model, which is the thing
  the whole provider abstraction exists to prevent.

**The dimension nobody prices but should be considered: cost per completed screen.** It is the metric
the customer actually cares about — they are buying screened candidates, not minutes. It also aligns
incentives: the platform is rewarded for higher answer rates and less voicemail waste, which is
exactly the behaviour that reduces provider cost.

---

## 11. Reliability of this model

**What I am confident about:** the arithmetic, and every OFFICIAL rate feeding it. Prices were read
off vendor pages on 18 Aug 2026 and adversarially re-verified.

**What is genuinely uncertain:**

- **The funnel.** 35% answer rate and 20% completion are assumptions. Real numbers could move cost per
  completed screen by 2× in either direction. **This is the single largest uncertainty in the model.**
- **Turn count and token estimates.** Derived from reasonable conversation shape, not measurement.
- **FX.** A 5% rupee move shifts every USD-denominated line. This is a real argument for the
  INR-native stack beyond data residency: **Sarvam and Plivo bill in rupees, so revenue and cost sit
  in the same currency.**
- **GST treatment.** Assumed 18% throughout. Plivo's India page says nothing about tax at all.
- **Concurrency limits.** Unpublished by Plivo, and they could cap the product well below what the
  minute budget suggests.

**What would most change the conclusions:** if Sarvam's unpublished latency turns out to be
unacceptable, TTS moves to Cartesia and the variable cost rises 2.4×, from ₹1.58 to ₹3.82/min. The
business still works, but the ₹10,000 budget buys ~340 completed screens instead of ~818.

---

*Recommendation and bootstrap stack: `PHASE_5_RECOMMENDATION.md`.*
