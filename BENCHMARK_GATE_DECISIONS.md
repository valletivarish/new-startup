# Real-Provider Benchmark Gate — Decisions Required

**Analysis only. Nothing in this document has been implemented.**
No provider selected · no SDK added · no credits purchased · no provider contacted ·
no production file touched.

This resolves the three blockers in `REAL_BENCHMARK_READINESS_REPORT.md` §6–7 to the point
where each becomes a single founder decision.

---

# A. LLM decision

## A.1 The existing contracts — there are two, deliberately

**Production:** `packages/providers/src/intelligence.ts` defines `IntelligenceProvider`:

```ts
interface IntelligenceProvider {
  readonly name: string;
  modelFor(tier: NormalizedLLMRequest['intelligenceTier']): string;
  complete(request: NormalizedLLMRequest): Promise<NormalizedLLMResponse>;
  stream(request: NormalizedLLMRequest): AsyncIterable<LLMStreamEvent>;
}
```

Provider-agnostic, tier-based, no vendor named. **This contract is not touched by anything
below.** Nothing in the benchmark imports it, and nothing in it needs to change.

**Benchmark:** `benchmark/src/adapters/types.ts` defines a separate, throwaway
`BenchmarkLlmAdapter`. It is separate on purpose — the benchmark needs marks production does
not care about (first non-empty chunk, per-chunk timing), and production must not grow those
because a measuring instrument wanted them.

`apps/api/test/production-boundary.test.ts` fails the build if a provider name appears in
production code, so whichever LLM is chosen **cannot** leak into the production architecture.

## A.2 Where the LLM is actually required

Exactly one place, in exactly one of the seven runs:

| Site | What it does |
|---|---|
| `benchmark/src/adapters/registry.ts:51` | `LLM_ADAPTERS = {}` — **deliberately empty** |
| `benchmark/src/runner/sweep.ts:462` | `runE2eSweep` resolves the LLM adapter |
| `benchmark/src/runner/e2e-runner.ts:220` | one completion per turn |

**The six component runs (3 STT + 3 TTS) do not need an LLM at all.** Only the end-to-end
run does — and that is the only run that measures `total_turn`, the pre-registered 1200 ms
gate. Without it, the gate is never tested by anything.

**What the benchmark asks the LLM to do** (`benchmark/src/runner/screen.ts`): produce one
plain sentence of at most 25 words, streamed. **No tools, no JSON schema, no structured
output.** "Suitable" is therefore a low bar, and almost every researched candidate clears it.

## A.3 Candidates already researched

From `PHASE_5B_DECISION_MATRIX.md` §5 and `PHASE_5_RECOMMENDATION.md` §LLM. **None is
implemented** — the registry is empty by design.

| Candidate | 5B score | Latency score | Price (in / out per 1M) | India |
|---|---|---|---|---|
| **`gemini-2.5-flash-lite`** | **4.02** | 3 | **$0.10 / $0.40** | residency unverified |
| `gpt-5.6-luna` | 4.02 | 3 | $0.20 / $1.20 (cached $0.02) | **India endpoint `in.api.openai.com`** |
| Sarvam 105B | 3.42 | **1** | ₹29.28 / ₹73.2 | INR-billed, Hinglish-native |
| `gemini-3.7-flash` | 3.72 | 3 | $0.75 / $3.75 | unverified |
| `gemini-3.1-pro-preview` | 3.57 | 2 | $2 / $12 | unverified |
| Claude Sonnet 5 | 3.70 | 3 | $2 / $10 | `us`/`global` only |
| Groq gpt-oss-120b | 3.25 | 5 | — | **NOT SUITABLE** — strict schema excludes streaming + tools |
| DeepSeek v4-flash | 3.22 | 2 | — | **NOT SUITABLE** — China, DPDP |

## A.4 Cost implications — and why cost does not decide this

The LLM is held constant across all stacks, so its cost is a fixed overhead on one run.

**Measured against the actual workload** (55 utterances × 2 protocol passes = 110
completions; ~263 input + 35 output tokens per turn — an **ESTIMATE**, derived from the
frozen 68-word system prompt, a five-turn history and the 25-word reply cap):

| Candidate | Whole benchmark | Worst case, all retries exhausted |
|---|---|---|
| `gemini-2.5-flash-lite` | **₹0.42** | ₹1.27 |
| `gpt-5.6-luna` | ₹1.00 | ₹2.99 |
| Sarvam 105B | ₹1.13 | ₹3.39 |
| `gemini-3.7-flash` | ₹3.46 | ₹10.38 |
| Claude Sonnet 5 | ₹9.23 | ₹27.68 |

**The entire spread is under ₹10.** Choosing on price here optimises a rounding error. Three
things actually matter:

1. **Latency** — `llm_first_token` sits *inside* the gated `total_turn`, with a 500 ms
   advisory budget. A slow constant eats the budget and could fail **every** stack for a
   reason that has nothing to do with STT or TTS. Sarvam 105B scores **1 of 5** on latency
   in the existing research — the worst of the viable options.
2. **Confound-freedom** — Sarvam is *also* an STT candidate and a TTS candidate. Using
   Sarvam's LLM in the end-to-end run puts three legs of the measured chain on one vendor's
   infrastructure, so shared routing, shared rate limits and shared regional behaviour would
   be inseparable from the provider comparison. Google is **not** among the six speech
   candidates, so a Gemini model is confound-free.
3. **Residency** — the LLM receives the **STT transcript**, which is candidate speech
   content and therefore personal data under the DPDP Act. **The LLM is a processor** and
   must appear in `disclosedProcessors` in every speaker's consent, or the sweep will refuse
   to run. This is why the LLM decision has to precede the recording session.

## A.5 Recommendation — for your approval, not adopted

> **`gemini-2.5-flash-lite`**

- Cheapest of every candidate (₹0.42 for the whole benchmark).
- Highest-scoring STANDARD option in the existing research (4.02).
- **Already the proposal in the approved `PHASE_5C_BENCHMARK_DESIGN.md` §4** — this is not a
  new choice, it is confirming one the design already made.
- Confound-free: Google appears in neither the STT nor the TTS candidate set.
- Adequate latency score (3), well clear of Sarvam 105B's 1.

**The one thing to weigh against it:** its India residency is recorded as *unverified* in
`PHASE_5_RECOMMENDATION.md`. If you want candidate transcripts to stay in India during the
benchmark, the alternative is **`gpt-5.6-luna`** via `in.api.openai.com` — the only frontier
lab publishing an India endpoint — at ₹1.00 for the whole benchmark. **A ₹0.58 difference
should not decide a residency question.**

**Explicitly not recommended:** Sarvam 105B, on the two grounds above — worst latency score
among viable options, and it is the only candidate that would confound the comparison.

**Choosing it does not select it for production.** It is the constant in one benchmark run.
The production LLM decision is a separate gate, and the existing research already says the
LLM layer is under 9% of variable cost and should be decided last.

---

# B. Benchmark-location decision

## B.1 Every reference, and what each document says

| Document | Line | Says |
|---|---|---|
| **`PHASE_5C_BENCHMARK_DESIGN.md` §0** | 24 | *"from a **Mumbai** (`asia-south1` / `ap-south-1`) VM"* — **this is the pre-registered rule** |
| `PHASE_5C_BENCHMARK_DESIGN.md` §9 | 411 | "**Mumbai** VM · ~₹300–500" |
| **`PHASE_5B_DECISION_MATRIX.md` §8** | 256 | *"on real Indian mobile audio, from a **Bangalore** VM"* — **the decision rule** |
| `PHASE_5_PROVIDER_COMPARISON.md` | 222 | "from a **Bangalore** VM" |
| `PHASE_5_PROVIDER_COMPARISON.md` | 211 | "carrier media edge → **Bangalore** VM · 20–250 ms · **Unknown**" |
| `PHASE_5_RECOMMENDATION.md` §benchmark | 315 | "from a **Bangalore** VM" |
| `PHASE_5_RECOMMENDATION.md` §infra | 173 | Infrastructure **primary: DigitalOcean BLR1 (Bangalore)**; backup AWS Mumbai |
| `PHASE_5B_DECISION_MATRIX.md` §7 | 169 | **DigitalOcean BLR1** is PRIMARY — *"only provider combining a real Indian region with managed Postgres in that region"* |
| `PHASE_5_PROVIDER_RESEARCH.md` | 351–358 | BLR1 is the only viable Indian region; **Fly.io Mumbai is "a trap"** — no managed Postgres there |
| `BRD's/10_ADRs/ADR-006` | 63, 143 | "DigitalOcean BLR1 **or** AWS Lightsail Mumbai" — never resolved |
| `benchmark/src/results/store.ts` | 99 | code comment: *"The design requires a **Mumbai** VM for real runs."* |

## B.2 The contradiction, stated plainly

**Mumbai** appears in the benchmark rule **once** — in the most recent document
(`PHASE_5C_BENCHMARK_DESIGN.md` §0), which is also the formal pre-registration.

**Bangalore** appears in the benchmark rule **three times** across the three earlier
approved documents, *and* is the primary infrastructure choice in both `PHASE_5B` and
`PHASE_5_RECOMMENDATION`.

So the newest document contradicts three older ones and contradicts the infrastructure
decision recorded in its own predecessor. Nothing indicates the change was deliberate; the
5C design document gives no reason for Mumbai and never mentions BLR1.

## B.3 Experimental impact

The benchmark exists to predict production latency, and its budget is 1200 ms p50.

- **Every provider call in the sweep is made from the benchmark host.** Its network position
  is a constant added to every measurement — it does not bias one provider against another,
  but it does bias the *absolute* figures against the gate.
- **`PHASE_5_PROVIDER_COMPARISON.md` line 211 already budgets 20–250 ms** for "carrier media
  edge → Bangalore VM" and marks it **Unknown**. A 200 ms uncertainty inside a 1200 ms
  budget is 17% of the gate.
- Benchmarking from one city and deploying to another leaves that delta **unmeasured and
  unbudgeted** — and it is applied to every turn of every call, forever.
- None of the four speech candidates is colocated with either city in a way that changes
  this: Azure's Indian region is **Central India**, which is neither.

**The deciding argument is not which city is faster. It is that the benchmark must run where
production will run**, or the number it produces is not the number production will see.

## B.4 Recommendation — for your approval, not adopted

> **Bangalore — DigitalOcean BLR1.**

Because production is going there. BLR1 is PRIMARY in `PHASE_5B_DECISION_MATRIX.md` §7 and
`PHASE_5_RECOMMENDATION.md`, and the research found it is the **only** provider combining a
real Indian region with managed Postgres in that region. Three of the four benchmark-rule
statements already say Bangalore. Choosing Mumbai would mean either benchmarking somewhere
production will not run, or reopening a settled infrastructure decision.

Cost is identical either way — `PHASE_5C_BENCHMARK_DESIGN.md` §9 budgets ₹300–500 for the VM
regardless of city.

**If approved, three things need amending** (none is a silent change):

1. `PHASE_5C_BENCHMARK_DESIGN.md` §0 and §9 — Mumbai → Bangalore (BLR1), with a note that
   this reconciles it with §8 of the decision matrix.
2. `benchmark/src/results/store.ts:99` — the code comment.
3. `REAL_BENCHMARK_READINESS_REPORT.md` §7.2 — mark resolved.

## B.5 A gap this exposes

**Run metadata records `host` (the machine's hostname) but not the region.** A pre-registered
location that is not recorded in the run cannot be checked afterwards, and nothing currently
stops the sweep being run from a laptop in a café — which you have explicitly ruled out.

**Proposed** (needs approval — it is a code change):

- Require `BENCHMARK_REGION` for any `--confirm` run, record it in `metadata.json` and print
  it in every report's provenance block.
- Refuse to spend when it is unset, in the same free pre-flight that already checks
  credentials, corpus validity and consent.

Roughly 20 lines plus a regression test. Without it, "we benchmarked from Bangalore" is an
assertion rather than a recorded fact.

---

# C. Corpus execution plan

Everything below is taken from `CORPUS_RECORDING_SPEC.md`, the Zod schema in
`benchmark/src/corpus/manifest.ts`, and the validator in `benchmark/src/corpus/loader.ts`.
**No new requirement is invented.** Where the existing documents are silent or inconsistent,
§C.8 says so rather than filling the gap.

## C.1 Exact recordings required

| | Utterances | Conversations | Turns each |
|---|---|---|---|
| Indian English (`en-IN`) | **20** | 4 | 5 |
| Hindi (`hi-IN`) | **15** | 3 | 5 |
| **Hinglish / code-mixed** | **20** | 4 | 5 |
| **Quiet subtotal** | **55** | **11** | |
| **Noisy re-record** (same script, subset) | **20** | 4 | 5 |
| **TOTAL TO RECORD** | **75** | **15** | |

**Speakers:** at least **two**, from different states (spec §3, "regional accent variation").
Each needs its own consent record.

**Why 55 and not 30:** `MIN_SAMPLES_FOR_VERDICT = 20`, and the protocol pools two passes.
55 × 2 = 110 pooled samples, which is where p95 stops being "the second-largest of thirty".

**You do not record the TTS material.** The 20 quality lines are frozen text in
`benchmark/src/quality/lines.ts` and are synthesised by the providers, not spoken by you.

## C.2 Recording format — enforced by `bench validate`

| Setting | Value | Enforcement |
|---|---|---|
| Format | 16 kHz+, **mono**, **16-bit WAV** | schema: `channels: 1`, `bitsPerSample: 16`; rate must match the manifest |
| **Maximum length** | **≤ 30 000 ms** | **ERROR** — one candidate's real-time endpoint caps at 30 s |
| Target length | 5–15 s | — |
| Minimum length | ≥ manifest `minDurationMs` (default 500 ms) | ERROR |
| Loudness | ≈ −23 LUFS | **warning** outside −33..−12 dBFS RMS |
| Leading silence | ≤ 200 ms | warning above |
| Not silent | peak ≥ 1% full scale | **ERROR** below |
| Not clipped | peak < 99.9% | warning above |

## C.3 Naming and manifest

```
benchmark/corpus/<name>/
  manifest.json          committed
  audio/conv-01-t1.wav   NEVER committed (gitignored)
```

Per utterance: `utteranceId`, `file` (relative, must resolve inside the corpus directory),
`language`, `codeMixed`, `reference`, `entities[]`, `speakerId`, `environment`
(`quiet`|`noisy`), `conversationId`, `turnIndex`.

**`conversationId` and `turnIndex` are required in practice.** Without them the end-to-end
run measures a cold first turn 55 times, and the report says so.

## C.4 Consent — blocks everything downstream

Per speaker: `speakerId` (**pseudonymous** — the manifest is committed), `obtainedAt`,
`coversCrossBorderTransfer: true`, `disclosedProcessors[]`, `retentionUntil`,
`deletionContact`.

**Each `disclosedProcessors` entry must BEGIN with the adapter id**, then prose for the
person signing:

```
"deepgram — Deepgram, United States (no India region available)"
```

The sweep **refuses to contact any provider not named by every speaker's consent**, checked
free, before `--confirm`. Verified working.

**The list must include the LLM**, because it receives the transcript. That is why
**decision A must be made before consent is signed.**

Processor disclosure, from the 2026-08-24 documentation review:

| Adapter | What the form must say |
|---|---|
| `azure` | Microsoft Azure AI Speech — **India (Central India)** |
| `deepgram` | Deepgram — **not India**; only EU/AU regions documented, default endpoint location undocumented |
| `cartesia` | Cartesia — default endpoint region not disclosed; India is enterprise-only |
| `sarvam` | Sarvam AI — **processing location not documented** for these APIs |
| *(LLM)* | per decision A — Google (residency unverified) **or** OpenAI (India endpoint) |

## C.5 Hinglish requirements

- 20 code-mixed utterances, `language: 'hinglish'`, `codeMixed: true`.
- `codeMixed` selects the sub-gate's sample. **Set it only where the speech genuinely
  switches** — marking easy monolingual utterances would make the 85% sub-gate trivially
  passable.
- Sub-gate: **≥85% entity accuracy on the code-mixed subset**, separate from the 90% pooled
  gate. A missing subset makes the run INCOMPLETE, not a pass.

## C.6 Entity categories and minimums

Kinds available: `number`, `duration`, `money`, `name`, `date`, `phone`, `location`, `text`.

| Category | Kind | Minimum |
|---|---|---|
| Names | `name` | 10 |
| Notice periods | `duration` | 10 |
| Numbers | `number` | 10 |
| Currency (lakh/crore) | `money` | 10 |
| Dates | `date` | 8 |
| Phone numbers | `phone` | 6 |
| Addresses / locations | `location` | 8 |
| Relocation / negation | `text` + `reject` | 6 |

**68 expectations minimum across 55 utterances.** Plus **≥12 deliberately difficult**
utterances (spec §3): mid-sentence code-switching, English technical terms inside Hindi,
a long answer near the 30 s cap, a mid-answer pause, self-correction, fast and slow speech,
fillers, a digit-by-digit read-back, a very short answer, two regional accents, background
speech, and a confusable pair ("nine"/"nineteen").

Rules: every `accept` form must appear in the reference (**ERROR** otherwise); numeric kinds
should declare `unit` (warning without — it is what distinguishes *wrong* from *missing*);
negation needs `reject`. **No profanity** — one provider's default profanity setting has an
undocumented effect on the field being scored.

## C.7 Quality validation

```bash
pnpm bench validate --manifest corpus/<name>/manifest.json
```

Free, contacts nothing, returns every issue rather than the first. `run` refuses an invalid
corpus unless `--ignore-corpus-errors`.

## C.8 Three gaps between the spec and the code — flagged, not filled

**1. `referenceAlt` is missing from the corpus spec. This one blocks the Hinglish sub-gate.**

The bias review found that the three STT adapters are asked for three *different* documented
configurations on code-mixed audio, and those configurations return **different alphabets**.
A flawless Devanagari transcription scored **125% word error** against a romanised reference.
The fix added `referenceAlt` (the same utterance in the other script) and made cross-alphabet
comparison **UNSCOREABLE** rather than a failure.

`CORPUS_RECORDING_SPEC.md` was written before that fix and **does not mention it**, and the
example manifest's Hinglish utterance has no `referenceAlt`.

**Consequence if not addressed:** whichever adapter returns Devanagari produces UNSCOREABLE
samples for all 35 Hindi and Hinglish utterances, and the Hinglish sub-gate cannot be applied
to it. **You would discover this after recording.**

**Needs:** a Devanagari `referenceAlt` for each of the 35 `hi-IN` + `hinglish` utterances, and
a one-paragraph amendment to the corpus spec. Approval required.

**2. The noisy condition has zero margin.**

20 noisy utterances against `MIN_SAMPLES_FOR_VERDICT = 20`. **One** hard failure or one
unscoreable sample takes it to 19 → INCOMPLETE, and the whole noisy run is wasted. This is
arithmetic from the existing spec, not a new requirement. Recording 3–4 spares would remove
it; that is your call.

**3. `transliterationAliases` is unused.**

The manifest accepts a corpus-level alias map, applied identically to reference and
hypothesis, for transliteration variance you decide is not a recognition error
("naukri"/"naukari"). The spec does not mention it. It can stay empty; noted so the option is
visible before the references are frozen.

## C.9 How the corpus avoids leaking provider identity

- The manifest **does** name providers — in `disclosedProcessors`, which is required and is
  the point. It lives in `benchmark/corpus/`, outside `apps/` and `packages/`.
- The production-boundary test scans only production trees, so this is structurally safe, and
  it fails the build if a provider name reaches production code.
- Audio is gitignored; manifests are committed; `speakerId` is pseudonymous.
- References and entity expectations never reach a provider. The end-to-end run feeds the LLM
  the **STT transcript**, never the reference — asserted by a regression test.

---

# D. Exactly who does what

## D.1 Founder — cannot be automated

| # | Action | Why it is yours |
|---|---|---|
| 1 | **Decide A (LLM) and B (location)** | Provider decisions are yours |
| 2 | **Create provider accounts, obtain API keys** | I will not create accounts or handle credentials |
| 3 | **Provision the Bangalore VM**, install Node + ffmpeg | Payment and access |
| 4 | **Ask Sarvam where audio is processed** | Undocumented; the consent wording depends on it |
| 5 | **Read Azure's Central India S0 rates in a browser** | The pricing page renders placeholders to a fetcher |
| 6 | **Sign the consent forms** with real speakers | Legal act |
| 7 | **Record 75 utterances** with 2+ speakers | Physical act |
| 8 | **Write and freeze 55 references + 68 entity expectations** | Ground truth is a human judgement — and it must be frozen before any provider call |
| 9 | **Read the Stage 1 smoke-test output** and confirm each adapter | Judgement about whether a response is what was expected |
| 10 | **Recruit 3 listeners** for the blind quality gate | Human ears |
| 11 | **Make the final provider selection** | The harness ranks; you choose |

## D.2 Claude — on your approval

| # | Action | Size |
|---|---|---|
| 1 | Write the benchmark LLM adapter for the approved model (fetch only, **no SDK**), register it, declare its env vars | ~80 lines + tests |
| 2 | Amend the Mumbai/Bangalore references in the three places listed in §B.4 | 3 edits |
| 3 | Add `BENCHMARK_REGION` — required for `--confirm`, recorded in metadata, printed in provenance | ~20 lines + test |
| 4 | Amend `CORPUS_RECORDING_SPEC.md` for `referenceAlt` (§C.8.1) | 1 section |
| 5 | Build a **recording-session scaffold**: generate an empty manifest with the 15 conversations, 75 utterance slots, correct ids, the consent block pre-filled with the disclosed processors — so you record into a known shape and `validate` works from the first file | ~150 lines |
| 6 | Build a **reference-entry helper** that reads a manifest, plays each file and prompts for reference, `referenceAlt` and entities, writing valid JSON | ~200 lines |
| 7 | Run `validate` on your recordings and fix every issue it names | free |
| 8 | Fill the rate card from the pages you read, and produce the priced plan | free |
| 9 | Build the Stage 1 smoke corpus (1 utterance) and the exact commands | free |
| 10 | After your Stage 1 results: correct adapters, clear `unverified`, add regression tests | as needed |

**Item 6 is the one that changes the day most.** Writing 55 references and 68 entity
expectations by hand in raw JSON is where a recording day becomes a recording weekend.

## D.3 Sequence, with the dependency the plan does not state

```
A (LLM)  ─┐
B (region)─┼─► consent wording ─► sign consent ─► RECORD ─► references+entities ─► validate
credentials┘                                                                          │
                                                                                      ▼
                          Stage 1 smoke (6 calls, read by hand) ─► component runs ×2
                                                                          │
                              pooling ─► blind listening gate ─► e2e run ─► cost ─► DECISION
```

**The non-obvious edge: A must precede consent.** The LLM receives candidate transcripts, so
it is a processor and must be named in `disclosedProcessors` before anyone signs. Deciding it
after recording means re-contacting every participant.

---

# The smallest set of decisions I need from you

| # | Decision | Recommendation | Cost of getting it wrong |
|---|---|---|---|
| **1** | **Benchmark LLM** | `gemini-2.5-flash-lite` — cheapest (₹0.42 total), already in the approved 5C design, confound-free. Choose `gpt-5.6-luna` (₹1.00) instead **only if** you want candidate transcripts to stay in India | Wrong choice ≈ ₹9 and a possible confound. Deciding it *late* means re-consenting every speaker |
| **2** | **Benchmark location** | **Bangalore (DigitalOcean BLR1)** — benchmark where production will run. Amend 5C §0, one code comment, one report section | Up to ~200 ms unmeasured on every turn, against a 1200 ms gate |
| **3** | **Record `BENCHMARK_REGION`, and refuse `--confirm` without it?** | **Yes** — otherwise the pre-registered location is an assertion, and a laptop run is not prevented | A result that cannot be audited back to where it ran |
| **4** | **Add `referenceAlt` to the corpus spec and record Devanagari alternates for the 35 Hindi/Hinglish utterances?** | **Yes** — without it the Hinglish sub-gate cannot be applied to any adapter that returns Devanagari | Discovered *after* recording; re-transcription, not re-recording |
| **5** | **Record 3–4 spare noisy utterances?** | **Yes** — 20 against a floor of 20 means one failure wastes the run | One bad take invalidates the whole noisy condition |
| **6** | **Shall I build the recording scaffold and reference-entry helper (D.2 items 5–6)?** | **Yes** — this is what makes 55 references + 68 expectations a day rather than a weekend | Hand-written JSON, and a validation cycle per typo |

Answer those six and I can execute everything in D.2 without further questions.

**Still true after this document:** no provider selected, no SDK added, no credits spent, no
production file modified, no provider contacted.

---

# E. Azure replaced by ElevenLabs — decided 2026-08-25

## E.1 What changed

`azure` is out of both candidate sets. `elevenlabs` takes its place in both.

| Role | Before | After |
|---|---|---|
| STT | sarvam, deepgram, **azure** | sarvam, deepgram, **elevenlabs** |
| TTS | sarvam, **azure**, cartesia | sarvam, **elevenlabs**, cartesia |
| LLM | gemini | gemini *(unchanged)* |

Three candidates per role, as pre-registered. No gate, threshold, or decision
rule moved. The corpus, the conditions, and the seven-run sweep are unchanged.

## E.2 Why — and why it is not a quality judgement

Nothing was measured. Azure was never run. This is a cost-of-access decision.

An Azure subscription is **disabled 30 days after signup** unless it is upgraded
to pay-as-you-go, and the $200 trial credit expires unused at the same moment.
It cannot be extended or reissued.

The benchmark needs 7.7 minutes of audio and 4,602 TTS characters. That is 2.6%
of the always-free F0 tier and touches **none** of the $200. So creating the
account to run the benchmark would have consumed a ~₹17,000 window — about two
months of the project budget — in exchange for nothing, unless Phase 6
integration happened to land inside the same 30 days.

The alternative considered and rejected was ordering: sign up for Azure last,
immediately before the sweep, preserving ~28 days of credit for Phase 6. That
works, but it makes the whole benchmark schedule hostage to a third party's
billing clock. Replacing the candidate removes the constraint entirely.

## E.3 What the swap costs — stated because it is a real loss

1. **Azure was the second India-region candidate. Sarvam is now the only one.**
   The data-residency story rests entirely on Sarvam, whose own processing
   location the provider does not document. That is a genuine weakening of the
   DPDP position and it should not be glossed.
2. **ElevenLabs is US-hosted**, adding real network latency from BLR1 against a
   400 ms derived STT gate. This is measured, not assumed — and if it loses on
   latency, that is a finding, not a defect.
3. **The enterprise-procurement argument for Azure is gone.** Less relevant for
   the SMB recruitment market, but not nothing.

`createAzureStt` and `createAzureTts` are kept in `RETIRED_ADAPTERS` and remain
under test. Restoring Azure is a move between two objects in the registry.

## E.4 Adapter status

Written 2026-08-25 and verified field by field against the current official
reference. **Never run against the live service.** `unverified: true`.

What the documentation check established, each of which would have silently
corrupted a run: auth is `xi-api-key`, not `Authorization: Bearer`; `scribe_v1`
is deprecated in favour of `scribe_v2`; STT is `multipart/form-data` with the
audio under `file`, not a raw binary post; `language_code` is ISO-639-1 (`hi`),
not the BCP-47 `hi-IN` Azure documents; TTS streams **raw bytes**, not SSE, so
an SSE parser would have yielded no audio and read as a provider failure;
`output_format=pcm_8000` is a documented value, keeping this candidate at the
same 8 kHz as every peer so the listening pack never resamples one voice.

For code-mixed audio the adapter **omits `language_code`** and lets the provider
auto-detect. ElevenLabs publishes no `multi` code the way Deepgram does and no
Indian-English locale the way Azure did; forcing either would have measured our
configuration choice on the one subset carrying its own sub-gate.

## E.5 The one UNVERIFIED item that blocks a WER comparison

**Whether Scribe returns verbatim text.** The reference documents a
`no_verbatim` boolean without defining what it toggles. The adapter sends
`no_verbatim=false` rather than trusting an undocumented default, and declares
`textNormalisation: 'verbatim'` on that basis.

**Stage 1 must read the returned transcript and confirm it is unpunctuated and
un-normalised before any WER from this adapter is compared with Sarvam's or
Deepgram's.** If it comes back punctuated and number-normalised, the comparison
is invalid and the sweep must stop — this is exactly the trap Azure's
`Display`/`Lexical` split set, and the documentation does not settle it.

## E.6 Historical documents were NOT rewritten

`PHASE_5_*`, `PHASE_5B_*` and `PHASE_5C_*` still discuss Azure as a candidate.
They are the record of what was believed and researched at the time, and editing
them to match a later decision would falsify that record. This section is the
authority on the current candidate set; those documents are the authority on how
it was arrived at.
