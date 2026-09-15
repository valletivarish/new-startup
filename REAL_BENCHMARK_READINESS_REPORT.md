# Real Benchmark Readiness Report

**Date: 2026-08-24.** Prepared for the first real benchmark run.

> **No provider has been selected. No provider has been integrated into production. No
> provider SDK is installed anywhere in this repository. No provider has been contacted.**
>
> Enforced mechanically, not by intent: `apps/api/test/production-boundary.test.ts` fails
> the build if a provider name appears in production code, if production imports the
> benchmark by name or by relative path, if a production `package.json` depends on it, if
> the benchmark moves under `apps/` or `packages/`, or if any provider SDK is declared.

---

## 1. The short answer

**The harness is ready. The corpus is not, and one decision is outstanding.**

Phase 5C delivered a measuring instrument. This phase pointed it at the four providers'
current documentation and at an adversarial review, and both found that the instrument would
have produced a confidently wrong answer:

- **Every one of the four adapters needed correction.** Two would have failed on the first
  request; one would have measured the wrong thing successfully, which is worse.
- **35 of 36 review findings were confirmed** by a verifier who reproduced each one against
  the code. Several would have chosen the winner outright.

All of them are fixed, each with a named regression test. What remains is not code.

| Blocker | Owner | Status |
|---|---|---|
| **No corpus exists** | Founder | ~1 day of recording. `CORPUS_RECORDING_SPEC.md` |
| **No credentials** | Founder | `PROVIDER_CREDENTIAL_SETUP.md` |
| ~~No LLM confirmed~~ | ~~Founder~~ | **RESOLVED 2026-08-24 — `gemini-2.5-flash-lite`** |
| **12 questions no documentation answers** | First contact | `FIRST_BENCHMARK_RUN_PLAN.md` Stage 1 |
| ~~Mumbai or Bangalore?~~ | ~~Founder~~ | **RESOLVED 2026-08-24 — Bangalore (BLR1)** |

---

## 2. IMPLEMENTED

Built this phase, on top of the Phase 5C harness.

### The end-to-end runner — the only run that measures the gate

Phase 5C left it unbuilt, and the derived component gates were a stopgap. They are
**necessary conditions, not sufficient ones**: percentiles do not sum, so no arithmetic over
six component runs produces a p95 total. Without this run the 1200 ms headline had never been
tested by anything.

- One STT + one LLM + one TTS on a shared clock, marks stitched into one turn timeline.
- **The pipeline is streaming**: synthesis starts at the first sentence boundary,
  concurrently with generation. A serial pipeline charged the turn for however long the model
  kept talking — failing stacks for a shortcut in the harness rather than for their latency.
- `total_turn` = end of speech → **first returned audio byte**, exactly as
  `06_PROVIDER_AND_COST_SPEC` §14 words it. The carrier leg is excluded and cannot be
  measured offline; `audio_out` is left unset rather than stamped 0.
- `endpointing` is never reported. Recorded utterances have pre-cut boundaries, so any figure
  would be the utterance length printed as a VAD decision.
- Conversation history is carried, and is the **STT transcript**, never the reference — an
  end-to-end run exists to feel the downstream consequences of transcription errors.

### Pooling — the pre-registered rule, finally executable

`bench pool` recomputes from `raw.jsonl` (never from stored aggregates, which could not be
audited) and applies the verdict to the **combined** sample. It refuses to pool runs that
differ in adapter, adapter version, model, corpus version, condition, codec, benchmark
version, retry budget, or per-utterance input checksum.

### Cost estimation — with provenance, or not at all

`bench plan --rates <card>` converts the plan's units into money. Every rate carries its
source, URL and the date it was read. **A rate that has not been verified is not a rate**:
anything missing prints `NOT PRICED`, the total is labelled a floor, and non-official rates
warn. It prices **two passes**, because the protocol runs each stack twice and pools.

### Adapter corrections

Fifteen documented mismatches across four adapters — see
`PROVIDER_ADAPTER_VERIFICATION_REPORT.md`. Language mapping moved off the runner and onto each
adapter, from its own documentation, recorded in run metadata.

---

## 3. TESTED

| Suite | Result |
|---|---|
| Benchmark | **267 passed** across 12 files |
| API (Testcontainers, real PostgreSQL) | **401 passed** across 20 files |
| Production-boundary | **6 passed** |
| `pnpm -w lint` | clean |
| `pnpm -w typecheck` | clean, all 6 projects |

New this phase: 16 end-to-end tests, 11 pooling and cost tests, 20 adapter conformance tests
against a stubbed fetch, 26 bias regression tests.

Operationally verified by running it:

| Check | Result |
|---|---|
| `doctor` | ffmpeg 8.1, G.726 only, warns it is not the mobile codec; all four adapters MISSING |
| `validate` | example corpus, 0 errors |
| `plan --rates` | 6 executable runs, e2e excluded and why; OFFICIAL priced, THIRD_PARTY warned, 4 lines NOT PRICED, total labelled a floor |
| `run` without credentials | refuses, will not fabricate a result |
| `run` with an undisclosed provider | **refuses before `--confirm`**, free |
| `run` without `--confirm` | prints the count, warns the corpus is below the sample floor, creates nothing |
| `--max-call` typo | rejected as an unknown flag |
| `--max-calls=7` | parsed; ceiling honoured |
| Full round trip on fakes | STT and TTS runs persist, aggregate, and reach the right verdicts |
| `quality-pack` | opaque samples, no provider name in the listener folder, mapping outside it |
| Re-running a run id | refused; existing data intact |

---

## 4. VERIFIED AGAINST REAL PROVIDER

**Nothing.**

No authenticated request has been made to any provider from this repository. Every adapter
carries `unverified: true` into run metadata and every report. `adapterVersion` ends in
`-unrun` and a test asserts it.

This row will stay empty until Stage 1 of `FIRST_BENCHMARK_RUN_PLAN.md` has been executed and
its results read by a human.

---

## 5. NOT VERIFIED

Twelve questions that documentation does not settle. Listed so first contact is a scripted
check rather than an expensive discovery. Full detail in
`PROVIDER_ADAPTER_VERIFICATION_REPORT.md` §5.

1. **Where Sarvam processes and stores audio** — not documented for the model APIs. Decides
   what the consent form must say.
2. **Where Deepgram's default endpoint processes audio** — India is documented as
   unavailable; the default endpoint's location is not stated.
3. **Which Azure endpoint host a Central India key accepts** — both forms are documented.
4. **Whether Azure's REST TTS body arrives progressively** — if time-to-first-byte scales
   with text length, the figure is not comparable with a streaming provider's.
5. **Whether aborting stops billing** — undocumented at all four providers. This was an
   explicit pre-flight requirement of the benchmark design and it cannot be met from docs.
6. **What HTTP status Cartesia returns for credit exhaustion** — if 429, the harness will
   retry into an empty balance. `--max-calls` bounds the damage.
7. **Whether Cartesia honours the requested output format** — the adapter now requests the
   documented mu-law 8 kHz pairing rather than an undocumented one.
8. **Whether the named Azure voices are served from Central India** — checkable free.
9. **Whether Sarvam's `mode=verbatim` matches the text form the references are written in** —
   its documented example renders digits as spoken words.
10. **Whether Sarvam honours `speech_sample_rate`** — now fails loudly instead of
    mis-measuring silently.
11. **Whether `CARTESIA_VOICE_ID` is compatible with `sonic-3.5`** — a documented error code.
12. **Azure Central India S0 rates** — the pricing page renders rate cells as placeholders to
    a fetcher.

Also not verified: **no streaming STT adapter exists for any provider.** All three protocols
were examined and none documents its binary framing explicitly enough to implement without
guessing — and a guessed framing fails in ways indistinguishable from provider unreliability.
**Streaming residual latency therefore cannot be compared across real providers.** The harness
measures it correctly; the fakes prove that. What is missing is verified vendor code.

---

## 6. BLOCKED

| # | Blocked | On | Consequence |
|---|---|---|---|
| 1 | The whole benchmark | **No corpus exists.** `corpus/example/` is synthetic tones | Nothing can be measured |
| 2 | Every run | **No credentials** | — |
| 3 | **The end-to-end run — the only one that tests the gate** | **No LLM confirmed.** The design proposes `gemini-2.5-flash-lite`; the founder has not confirmed it, and registering an adapter for an unconfirmed model would be choosing a provider | `total_turn` stays unmeasured; only the derived component gates apply |
| 4 | The deciding condition's fidelity | This ffmpeg encodes **G.726 only**, not AMR-NB | Results stay comparable between providers — identical input, checksummed — but are optimistic relative to a real mobile call. Recorded in metadata, printed in every report, flagged by `doctor` |
| 5 | Cost ranking for one provider | **No published per-character price anywhere** | Rankable on latency and quality, not on cost |
| 6 | Endpointing, barge-in, answer rate, carrier latency | No phone call | Pilot work, behind the regulatory gate |

---

## 7. REQUIRES FOUNDER DECISION

### 7.1 Which LLM is held constant

The design proposes `gemini-2.5-flash-lite`. Until it is named, the end-to-end run cannot
execute and the 1200 ms gate is never tested. **This is the highest-value decision on the
list**, and it is cheap: the LLM is under 9% of variable cost, the runner is written and
tested, and the adapter is one small file.

### 7.2 Mumbai or Bangalore

`PHASE_5C_BENCHMARK_DESIGN.md` §0 says a **Mumbai** VM (`asia-south1` / `ap-south-1`).
`PHASE_5B_DECISION_MATRIX.md` §8 says a **Bangalore** VM. Both are approved documents and
they disagree. The difference is small but it is inside a 1200 ms budget, and the run records
the host either way. **Pick one and amend the other document** — DigitalOcean BLR1 is
Bangalore and is the primary infrastructure candidate, which argues for Bangalore.

### 7.3 The blind listening line set

The design (§6.1) specifies **10 code-mixed lines, each containing an Indian name, a
lakh/crore figure, a date, and an English technical term**. The frozen set is 20 lines with
those probes distributed across them, and **only 2 of 20 contain a date** — so a provider
that mangles dates has two chances to be caught.

The 20-line count is load-bearing: the line count *is* the TTS sample size, and the floor is
20. The options are to accept thinner date coverage, or to rewrite the set so more lines carry
all four probes. **No run has happened, so the set can still be changed** — but changing it is
a deliberate, recorded decision, not something to do quietly.

### 7.4 Whether to accept G.726 as the deciding condition

Installing an ffmpeg built with `libopencore-amrnb` gets the closer approximation to the
Indian mobile radio leg. Without it the condition is a real ITU-T narrowband codec but not the
mobile one. Comparisons between providers stay valid; the absolute figures are optimistic.

### 7.5 Consent wording, before recording

The consent form must name the processors and their countries. Two of the four cannot be
described as processing in India, and one cannot be described at all until Sarvam answers.
**A form saying only "for internal testing" makes the corpus unusable for at least two
candidates**, and re-consenting means re-contacting every participant.

---

## 8. Remaining risks

| Risk | Why it matters | What is in place |
|---|---|---|
| Adapters are still unverified | First contact will produce errors | 4xx and unparseable 2xx are classified as OUR defect, excluded from the failure gate, and make the run INCOMPLETE |
| Only fakes have exercised the path | Fakes cannot surprise you the way an API can | The fakes are deliberately hostile, and most confirmed findings were found *because* of them |
| The residual includes our own upload | All three STT adapters are batch: they drain, encode a WAV and POST, all after the endpoint mark | Affects all three roughly equally — a systematic overstatement, not a bias between providers. Documented in the harness README |
| The corpus does not exist | Expectations written after seeing results are not expectations | Write and freeze them first; `validate` rejects unsatisfiable ones |
| One run is one sample of a provider's day | A close result could be network weather | Two runs, pooled, and pooling refuses mismatched inputs |
| Thresholds were amended this phase | Amending after a run would be rationalisation | Every amendment was made **before any run**, is recorded in the design document §6.0.1, and is in git history |
| The reviewers were AI agents | They confirmed 35 of 36 of their own findings, which is suspiciously high | Each finding was reproduced against the code by a separate verifier instructed to refute it; I checked the mechanism myself before fixing. Treat the list as strong evidence, not proof |

---

## 9. What happens next

1. **Founder:** name the LLM (§7.1) and pick the region (§7.2).
2. **Founder:** create accounts, set credentials — `PROVIDER_CREDENTIAL_SETUP.md`.
3. **Founder:** record the corpus — `CORPUS_RECORDING_SPEC.md`. Budget a full day.
4. **Together:** Stage 1 of `FIRST_BENCHMARK_RUN_PLAN.md` — seven provider calls, read by hand.
   This is where the twelve undocumented questions get answered and where money is saved.
5. **Then, and only then:** the six component runs, twice, pooled; the blind listening gate;
   the end-to-end run; and the rule applied mechanically.

The output of all of that is **a recommendation**, not a selection. The harness ranks
providers. The founder chooses, and the regulatory gate still sits ahead of any live call.

---

*Every figure in this report was produced by running the code. Where something was not run,
this report says so.*
