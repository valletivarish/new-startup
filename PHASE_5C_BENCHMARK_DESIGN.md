# Phase 5C — Benchmark Design (revision 2)

**Status: for founder approval. This document IS the gate.**
No provider selected. No adapter written. No contract signed. No SDK installed.

**Revision 2** incorporates an adversarial review of revision 1 by three independent reviewers
(validity, gameability, execution). **They found five critical defects in the instrument — all of
which had passed the original 38-test validation.** All five are fixed, each with a named regression
test. §2.1 records them, because "the instrument was validated" is worth nothing if the validation
missed the behaviour the instrument will actually meet.

---

## 0. What this phase decides

**Decides:** which STT and which TTS go into production, by measurement rather than by score,
marketing claim, or preference.

**Does not decide:** telephony (Plivo remains *preferred implementation candidate*, not committed),
the LLM (under 9% of variable cost — decide it last), or anything regulatory.

**The pre-registered rule, fixed before any number exists:**

> Run the pipeline on real Indian mobile audio **from a Bangalore VM (DigitalOcean `BLR1`)**.
> A stack passes if it meets **≤1200 ms total-turn p50**, **≤2000 ms p95**, **≤25% WER**,
> **≥90% entity accuracy pooled**, **≥85% entity accuracy on the Hinglish subset**, and
> **≤1 hard failure in 30 turns**.
> Among passing stacks, apply the **blind listening gate** (§6.1), then take the cheapest survivor.
> If none passes, take the closest and reprice.

---

## 1. Your architectural requirement — implemented

Provider-specific audio formats must not leak into the application. Done — and the research showed
why it was needed, since carriers do not agree:

| Carrier | Wire format |
|---|---|
| Plivo | mu-law 8 kHz, no transcoding |
| TTBS Smartflo | `audio/x-mulaw`, 8000 Hz, payload multiples of 160 bytes |
| Knowlarity | linear16 PCM, sample rate **selectable** 8/16/24/32/48 kHz |
| Exotel | 16-bit LE mono PCM, base64 inside JSON |
| Twilio | mu-law 8 kHz, base64 inside JSON |

`packages/providers/src/voice.ts` defines `NormalizedAudioFrame`, `AudioFormat`, `MediaStream` and
`AudioCodec`; `TelephonyProvider` gained `openMediaStream()`. A phase-boundary test asserts no
carrier name appears in the contract's code.

**Two additions beyond your sketch, both earning their place:**

- **`clear()` on the media stream** — barge-in is not "stop sending"; audio already buffered at the
  carrier keeps playing. Without a discard primitive an interruption lands after the agent finishes
  its sentence.
- **`VoiceActivityDetector` as its own interface** — endpointing is the largest tunable slice of
  perceived latency and sits *before* STT, so it must be swappable independently of the STT vendor.

---

## 2. The instrument

| Module | Responsibility |
|---|---|
| `benchmark/audio.ts` | G.711 mu-law to standard, PCM conversion, 8k↔16k resampling |
| `benchmark/latency.ts` | Turn marks, per-stage attribution, nearest-rank percentiles |
| `benchmark/accuracy.ts` | WER, CER, **entity accuracy**, Indian-English normalisation |
| `benchmark/verdict.ts` | The pre-registered rule, applied mechanically |
| `benchmark/harness.ts` | Drives a scripted screen through any STT/LLM/TTS |
| `benchmark/report.ts` | JSON + markdown artifacts |

**49 benchmark tests**, part of **445 passing** across the project.

### 2.1 What the adversarial review found — and why it matters

All five passed revision 1's validation. Every one would have produced a wrong provider decision.

| # | Defect | Consequence if unfixed |
|---|---|---|
| **1** | **Entity matching used substring search on a joined string.** `"19 years"` contains `"9 years"`; `"15 lakhs"` contains `"5 lakhs"`. | The teens-for-units confusion is the most common Indian-English STT error **and the exact case the metric exists to catch** — it was scored as a *successful capture*. A provider genuinely at 82% could clear the 90% gate, and the inflation favoured precisely the providers that make that error. |
| **2** | **`speechEndedAt` was marked before any audio was consumed**, and audio was fed as fast as the consumer pulled. | The STT stage measured cold whole-utterance processing — proportional to utterance length — instead of post-endpoint residual latency. This **erases streaming STT's entire production advantage** and biases the comparison toward batch APIs on the tightest-budget stage. It also meant re-recording the corpus with longer answers would change the verdict, which pre-registration exists to prevent. |
| **3** | **Multiple STT finals overwrote instead of accumulating.** | Real streaming STT emits one final per endpointed segment; a mid-answer pause produces several. Only the last was kept, so a long answer scored ~50% deletions — **penalising exactly the streaming providers under comparison**. Survived validation because both fakes emitted a single final. |
| **4** | **Stage budgets were hard gates in code, advisory in the document.** | The two readings give different verdicts, and since the stage budgets sum to **1100 ms**, the code silently imposed a *tighter* total than the 1200 ms pre-registered. (Revision 1 also claimed they "sum to more than the total" — that was arithmetically wrong.) |
| **5** | **`maxTurnFailureRate: 0.02` was unreachable at n=30** — one transient 429 is 3.3%. | Stacks would fail for network weather rather than provider quality. |

**Also fixed:** the TTS stream was fully drained though only the first byte is timed — paying for
audio nobody measures, and the direct cause of the free-tier overrun in §9.

**The deeper lesson, recorded honestly:** the fakes did not model real provider behaviour. They never
consumed their audio and emitted exactly one final. **A validation suite is only as good as the
fidelity of its fakes**, and revision 1's were too polite. The regression tests now include an STT
that consumes audio, one that emits three finals, and an assertion that measured STT latency is
*independent of utterance length*.

---

## 3. What is measured

### Latency chain

```
speech_ended  →  stt_final  →  llm_first_token  →  tts_first_byte  →  audio_out
```

Every stage separately — a single "1.4 s" tells you the agent is slow but not what to change.
**p50 and p95, nearest-rank, never means.** **Failed turns excluded from latency, counted
separately** (otherwise a provider looks fast by failing quickly).

**`endpointing` is deliberately not reported offline.** Recorded utterances have pre-cut boundaries,
so any figure would be a fabricated ~0 ms printed as a measurement. Absent is honest.

### Accuracy — why WER alone would mislead

```
reference   "I have nine years of experience"
hypothesis  "I have 9 years of experience"        → 1 word wrong, zero harm

reference   "my notice period is ninety days"
hypothesis  "my notice period is nineteen days"   → 1 word wrong, screen ruined
```

Identical WER, opposite consequences. So the benchmark gates on **entity accuracy** — did the facts a
screening call exists to collect survive transcription.

**Three-way scoring, added in revision 2.** A fact is `found`, `missing`, or **`wrong`**:

- **missing** → the agent re-asks. Recoverable.
- **wrong** → a confidently mis-heard notice period **silently rejects a qualified candidate**.

Scoring them identically understates the harm the gate exists to bound, so `entitiesWrong` is
tracked separately and surfaced prominently in the report. It is detected by declaring a `unit` on
the expectation (`days`, `years`, `lakhs`); a *different* number adjacent to that unit is `wrong`
rather than merely absent.

Normalisation folds spoken digits to numerals, keeps Devanagari, and applies caller-supplied
transliteration aliases identically to reference and hypothesis.

---

## 4. Scope — three per layer

| Layer | Candidates |
|---|---|
| **Telephony** | Plivo · TTBS Smartflo *(pilot only — not benchmarked offline)* |
| **STT** | Sarvam Saaras v3 · Azure Central India · Deepgram Nova-3 |
| **TTS** | Sarvam Bulbul v2 · Azure Neural (Central India) · Cartesia Sonic |
| **LLM** | Held constant — `gemini-2.5-flash-lite` proposed |

Holding the **cheapest** LLM constant is the right control: a premium model would flatter every
stack equally and hide the differences the benchmark exists to find.

### 4.1 The sweep is 7 runs, not 9 — the highest-value cut

Revision 1 specified a 3×3 STT×TTS cross product. **That is two-thirds waste**: TTS
time-to-first-byte does not depend on which STT produced the text, and WER does not depend on the
TTS at all. It re-measured each provider three times on identical inputs — and it is what blew the
Cartesia free tier.

| Runs | What |
|---|---|
| **3** | **STT-only** — audio in, transcript out. Residual latency + WER + entity accuracy. |
| **3** | **TTS-only** — a frozen set of ~30 canonical agent replies. First-byte latency. |
| **1** | **End-to-end**, leading STT + leading TTS, to validate `total_turn` against the gate. |

The end-to-end run is required because **percentiles cannot validly be summed across stages** — a
p95 total is not the sum of p95s.

---

## 5. The corpus

The most consequential design decision here, because the corpus determines whether the result means
anything.

### 5.1 Recording specification — follow literally

| Setting | Value |
|---|---|
| Format | **16 kHz (or higher) mono 16-bit WAV** — never record at 8 kHz; the reference cannot be recovered |
| Loudness | Normalise every file to **−23 LUFS** |
| Leading silence | Trim to **≤200 ms** |
| Structure | **Continuous 5–6 answer conversations**, not disconnected lines — `runCase` accumulates history across turns |
| Environments | Record the same script **twice**: quiet room, and the real noisy environment |

> **Noise mixed in afterwards is a simulation, not a condition**, and must be labelled as one. That
> is the same honesty line §7 draws for carrier latency.

### 5.2 Conditions — and an honest relabel

| Condition | How produced | Role |
|---|---|---|
| `clean_16k` | As recorded | Upper bound. **Diagnostic only — run on the winner, never in the decision sweep.** |
| **`narrowband_8k_amr`** | **AMR-NB round trip**, then mu-law | **The decision condition.** |
| `narrowband_8k_noisy` | Same, from the noisy recordings | Robustness |
| `live_pstn` | Real calls through Plivo/TTBS | **The only real thing** — pilot |

**Revision 1 called the linear-downsample path "Real mobile audio through PSTN narrowband". It was
not** — linear downsampling reproduces the bandwidth limit and quantisation, but none of the
AMR-NB/EVS lossy compression the radio leg actually applies. The condition is renamed to say what it
is, and produced properly, free, with one command:

```bash
ffmpeg -i in.wav -ar 8000 -ac 1 -c:a amr_nb -b:a 12.2k mid.amr
ffmpeg -i mid.amr -f s16le -ar 8000 out.raw
```

**Only `live_pstn` is the real thing.** Everything offline is a closer or further approximation, and
the document now says which.

### 5.3 Language mix and size

Revision 1 specified 30 turns split 40/25/35 — that is 7 Hindi and 10 Hinglish turns, and **every
per-language verdict would return INCOMPLETE**. Corrected:

| Split | Turns in the deciding condition |
|---|---|
| Indian English (`en-IN`) | ~20 |
| Hindi (`hi-IN`) | ~15 |
| **Hinglish / code-mixed** | **~20** |
| **Total** | **~55 utterances**, plus a noisy re-record of a subset |

**Verdict rule, pre-registered:** the headline verdict **pools all languages** within the deciding
condition. **Hinglish additionally carries its own entity-accuracy sub-gate (≥85%)** that a stack
must clear separately.

Without that sub-gate a stack could pass pooled at 91% while sitting at 78% on the 35% of traffic
that is code-mixed — and pooling would hide the single strongest reason to run this benchmark.

> **Revision 1 said "~30 utterances × 3 splits is a couple of hours". That was optimistic.** With
> consent capture, retakes, two environments, and writing per-utterance entity expectations, **budget
> a full day.**

### 5.4 Consent

Voice samples of real people. DPDP applies to the corpus exactly as to production.

**The consent form must name cross-border transfer explicitly.** Deepgram and Cartesia are US
processors; the samples leave India the moment the benchmark runs. A form saying only "for internal
testing" makes the corpus **legally unusable for two of the three STT candidates and one of the
three TTS candidates** — and re-consenting means re-contacting every participant. Name the
processors, their countries, the retention period, and the deletion route.

---

## 6. Pre-registered thresholds

```ts
const THRESHOLDS: BenchmarkThresholds = {
  totalTurnP50Ms: 1200,       // THE gate — 06_PROVIDER_AND_COST_SPEC §14
  totalTurnP95Ms: 2000,       // THE gate
  sttP50Ms: 300,              // advisory budget — attribution only
  llmFirstTokenP50Ms: 500,    // advisory — TIME TO FIRST TOKEN
  ttsFirstByteP50Ms: 300,     // advisory
  maxWer: 0.25,
  minEntityAccuracy: 0.90,    // pooled; Hinglish sub-gate 0.85 applied separately
  maxHardFailures: 1,         // a COUNT, not a rate
};
```

**Stage budgets are advisory attribution and never change the verdict.** They say where the time
went. They sum to 1100 ms; treating them all as gates would silently impose a budget tighter than
the 1200 ms being approved. `evaluate()` returns them in a separate `warnings` array.

### 6.0 Component gates — added after the implementation review

The rule above has a hole that only became visible once the runners existed: **the 1200 ms total is
measured by the end-to-end run, and the end-to-end run is the one run that was not implemented.**
The six runs that *can* execute each measure a single stage, so under the rule as written their
latency reached the verdict only as an advisory warning. A provider with a 5 s post-endpoint
residual and one with 150 ms received the same mechanical verdict — nullifying, at the decision
step, the entire real-time-pacing design that exists to tell those two apart.

A component run is therefore gated at the point past which that stage **alone** cannot fit inside
the pre-registered total, even if every other stage hits its budget exactly:

```
stt gate            = totalTurn − (llmFirstToken + ttsFirstByte) = 1200 − 800 = 400 ms  (p95: 1200)
tts_first_byte gate = totalTurn − (stt + llmFirstToken)          = 1200 − 800 = 400 ms  (p95: 1200)
```

This is **derived from the total, not added to it**: it can never impose a total tighter than the
1200 ms approved, which is the objection that made the stage budgets advisory in the first place. A
component over its 300 ms *design budget* but under its 400 ms *gate* passes with a warning — the
turn still fits, with less room for the rest than the budget assumed.

**Per-run-kind thresholds.** An STT run carries the accuracy gates. A **TTS run does not**: it has
no transcript, so handing it `maxWer` and `minEntityAccuracy` made every TTS run permanently
INCOMPLETE for a reason no provider could ever satisfy, at full cost.

**A missing code-mixed subset is INCOMPLETE, not a warning.** Every other missing measurement
already was. A run that never tested the linguistic reality of these calls has not earned a PASS.

**A 4xx is our defect, not the provider's.** Every real adapter was written from documentation and
has never touched a live service, so the likeliest first-contact outcome is a wrong endpoint, field
name or language code. Those are excluded from the failure gate and make the run INCOMPLETE: this
run did not measure the provider. Counting them would print a confident FAIL for a service whose
only sin was that our request shape guessed wrong.

**The frozen TTS line set is 20 lines, not 10.** The line count *is* the TTS sample size, and the
sample floor is 20 — so a ten-line set could never reach a verdict at all.

**Retry policy, pre-registered:** a turn counts as failed only after **2 retries on transient
transport errors** (HTTP 429/5xx, socket reset). Retried turns are excluded from the latency sample
and logged.

**Two-run combination, pre-registered:** each stack runs twice at different times of day.
**Pool the turns into one sample and compute percentiles on the pooled set** — do not compare two
verdicts. Pooling also lifts n to ~110, giving p95 real resolution instead of making it the
second-largest of thirty.

### 6.0.0 Benchmark location — amended 2026-08-24, founder-approved

Revision 2 of this document said **Mumbai**. `PHASE_5B_DECISION_MATRIX.md` §8,
`PHASE_5_PROVIDER_COMPARISON.md` and `PHASE_5_RECOMMENDATION.md` all said **Bangalore**, and
DigitalOcean **BLR1** is the PRIMARY infrastructure choice in two of them — the research found
it is the only provider combining a real Indian region with managed Postgres in that region.
The Mumbai line was an unexplained outlier in the newest document.

**Resolved in favour of Bangalore (BLR1), because the benchmark must run where production
will run.** The host's network position is a constant added to every measurement;
`PHASE_5_PROVIDER_COMPARISON.md` already budgets 20–250 ms for "carrier media edge to
Bangalore VM" and marks it Unknown, which is up to 17% of a 1200 ms gate. Benchmarking from
one city and deploying to another leaves that delta unmeasured on every turn.

`BENCHMARK_REGION` is now **required** for any spending run, checked in the free pre-flight,
recorded in run metadata, and printed in every report's provenance block — as **declared, not
verified**, because nothing inside the process can prove where a machine is. Pooling refuses
to combine runs from different regions.

### 6.0.2 The LLM held constant — decided 2026-08-24, founder-approved

**`gemini-2.5-flash-lite`.** Chosen on latency, confound-freedom and residency disclosure —
not on price, which is a rounding error here (the whole benchmark's LLM bill is about ₹0.42,
and the spread across every candidate is under ₹10).

- **Latency:** `llm_first_token` sits inside the gated total. The cheapest-per-token Indian
  option scores 1 of 5 on latency in the existing research and would have eaten the budget,
  failing every stack for a reason unrelated to speech.
- **No confound:** Google appears in neither the STT nor the TTS candidate set, so no leg of
  the measured chain shares a vendor with another.
- **Residency, recorded honestly:** Google documents **no processing location and no India
  region** for the Developer API, and its terms allow caching "in any country in which Google
  or its agents maintain facilities". Recorded as `unverified`, exactly like the speech
  adapters, and disclosed in those words on the consent form.
- ⚠️ **The unpaid tier must not be used.** Google's terms state that unpaid input is used to
  improve Google products and that human reviewers may read it. That is incompatible with
  informed consent for recorded speech.

**This does not select a production LLM.** It is the constant in one benchmark run.

### 6.0.1 Amendments after the 2026-08-24 verification and bias review

All made **before any run**, and therefore still pre-registration rather than
rationalisation. Each exists because an adversarial verifier reproduced a defect that would
have produced a confidently wrong provider decision.

- **Scoring is script-aware.** Each STT adapter is asked for its own documented language
  configuration on code-mixed audio, and those configurations return different alphabets. A
  flawless Devanagari transcription scored **125% WER** against a romanised reference — a
  triple FAIL for perfect recognition. A hypothesis is now scored against a reference in the
  same alphabet (`referenceAlt` in the manifest), and a cross-alphabet comparison is
  **UNSCOREABLE**: excluded from accuracy and reported as INCOMPLETE, never as a FAIL.
- **A response we cannot parse is OUR defect.** `response_shape_unrecognised` joins
  `client_request_error` as an adapter defect. Every adapter parses a shape taken from
  documentation and never exercised; at `maxHardFailures: 1`, two mis-parses printed a FAIL
  for a provider that answered every question correctly.
- **A buffered first-byte figure is not comparable to the component gate.** An adapter that
  buffers the whole response has no "time to first byte" in the sense the gate means. The
  figure is reported and the gate is not applied; the run is INCOMPLETE on that axis.
- **A hard-failed utterance counts its entities as missing.** Failing outright previously
  removed an utterance from the entity denominator entirely, so failing scored strictly
  better than transcribing badly.
- **The end-to-end pipeline is streaming.** Synthesis begins at the first sentence boundary,
  concurrently with generation. Awaiting the whole completion charged `total_turn` for
  however long the model kept talking, which would have failed stacks for a shortcut in the
  harness rather than for their latency.
- **Consent is enforced, not merely required.** A sweep refuses to contact any provider not
  named in every speaker's `disclosedProcessors`.
- **Every TTS adapter requests the same documented 8 kHz format**, so no provider is
  resampled to be heard beside its peers.
- **The pooled verdict is the verdict.** `bench pool` recomputes from `raw.jsonl` and applies
  the rule to the combined sample, refusing to pool runs that differ in adapter, corpus
  version, condition, codec, retry budget or per-utterance checksum.

### 6.1 The blind listening gate — new in revision 2

**Revision 1 had no TTS quality gate at all.** It would have selected the cheapest TTS emitting a
first byte inside 300 ms, with no check on *what that byte was the start of*.

For an outbound screening call **the voice is the product surface**. A TTS that reads "15 lakhs" as
"fifteen lakh zero zero zero zero zero", or mangles an Indian name, causes hang-ups no latency figure
predicts. It is also the **least reversible** half of the decision — STT can be swapped behind the
normalized boundary with candidates none the wiser; the voice is what every candidate hears.

> **Gate, applied BEFORE the cheapest-passing tiebreak:** synthesise the same 10 code-mixed screening
> lines — each containing an Indian name, a lakh/crore figure, a date, and an English technical term
> — on all three TTS candidates. Present them **blind and shuffled** to 3 listeners. **Any candidate
> 2 of 3 mark unacceptable is excluded.**

~30 minutes and ~400 characters of quota. It is the only thing between the pre-registered rule and
shipping the cheapest robot.

---

## 7. What the harness does — and refuses to do

**Does:** drives STT → LLM → TTS, times every stage, scores accuracy, applies the rule, writes JSON +
markdown to `benchmarks/`.

**Refuses:** placing phone calls. **Carrier latency cannot be simulated honestly.**

| Stage | Measures | Needs |
|---|---|---|
| **Bench** (offline) | STT, LLM, TTS, accuracy | Corpus + loader + adapters + API keys. **No carrier, no contract.** |
| **Pilot** (live) | Carrier media-edge RTT, **endpointing**, **barge-in**, answer rate | Indian entity, number, DLT |

**Barge-in moved to the pilot column.** Revision 1 listed it under "also measured" and the field is
declared but never populated — the harness issues no interruption. It cannot be measured offline.

**One-line pre-flight before recording anything:** for each TTS candidate, confirm from its docs that
an in-flight synthesis can be **cancelled**, and that cancellation **stops billing**. A 20-minute
documentation check that can eliminate a candidate before a single file is recorded.

---

## 8. Honest limitations

1. **Resampling is linear interpolation with averaging on downsample.** Fine for measurement; a
   polyphase resampler belongs in production.
2. **Endpointing and barge-in are unmeasurable offline.** Pilot work — and endpointing is the largest
   tunable slice of the budget.
3. **Entity accuracy depends on the expectations you write.** Write them once, review, freeze before
   any run. **Accept-lists cannot express negation** — "I cannot relocate" still matches the accept
   form "relocate", so negative surface forms must be enumerated or the entity dropped.
4. **Sequential execution**, so cases do not contend for a rate limit and inflate each other.
5. **One run is one sample of a provider's day** — hence the two-run pooling rule in §6.
6. **Cost is calculated, not measured** — `PHASE_5B_UNIT_ECONOMICS.md` remains the source.
7. **Even `narrowband_8k_amr` is an approximation.** It omits handset noise suppression, AGC, packet
   loss and concealment. Only `live_pstn` is the real thing.

---

## 9. What running this costs

| Provider | Free allowance | Sufficient? |
|---|---|---|
| Sarvam | ₹100 credits | Yes |
| Deepgram | $200 credits | Comfortably |
| Azure Speech | 0.5M chars/month TTS, recurring | Yes |
| Cartesia | Free tier ~27 min | **Yes — after the §4.1 cut and first-byte break.** Was over the wall at 9 runs. |
| Gemini | Free tier | Yes |
| **Bangalore VM (BLR1)** | Small instance, a few days | **~₹300–500 — was missing from revision 1** |

**Under ₹1,000 of marginal cost.** The real cost is a day of your time recording the corpus.

---

## 10. Sequence — corrected

Revision 1 said step 5C₃ "needs API keys only". **That was wrong and would have cost you a weekend.**
There is no path from a recorded file to a `BenchmarkTurn`: no WAV reader, no manifest schema, no
frame chunker, no sweep runner, and **six thin benchmark adapters must exist before a single number
is produced**.

```
  ✅ 5A   Architecture                done — Phase 4, unchanged
  ✅ 5B   Research                    done — 4 documents, corrected
  ✅ 5C₁  Instrument                  done — 49 tests, 5 critical defects found and fixed
  ⬜ 5C₂  Corpus loader + manifest    ME — build BEFORE recording, so files drop straight in
  ⬜ 5C₃  Corpus recording            FOUNDER — ~55 utterances × 2 environments, ~1 day
  ⬜ 5C₄  Benchmark adapters (×6)     ME — throwaway, not production adapters
  ⬜ 5C₅  Sweep runner                ME
  ⬜ 5C₆  Run the sweep               API keys only — genuinely, at this point
  ⬜ 5D   Commercial + regulatory     PARALLEL — start now, weeks of latency
  ⬜ 5E   Provider decision           apply §0 mechanically
  ⬜ 5F   Production adapters         only after 5E
  ⬜ 5G   Live pilot                  only after 5D clears the regulatory gate
```

**5C₂ must precede 5C₃** so the recording session produces files that load without rework. Manifest
shape: `{ file, language, condition, reference, entities[] }` per utterance.

**5D runs in parallel starting now** — the questions are drafted in `PHASE_5B_TELCO_RESEARCH.md` §12
and have weeks of latency you should start absorbing.

**The regulatory gate is a precondition on 5G, not a step:**

```
Legal classification → DLT/consent/caller-ID → carrier approval → production outbound
```

The pipeline can be built before that clears. **It must not dial a real candidate before it does.**

---

## 11. What I need from you

1. **Approve or amend the thresholds** in §6, including the new **Hinglish sub-gate (85%)** and the
   **blind listening gate** (§6.1). Once a run happens they are frozen.
2. **Approve the corpus design** in §5 — especially ~55 utterances rather than 30, two recording
   environments, and `narrowband_8k_amr` as the deciding condition.
3. **Confirm the LLM to hold constant** — `gemini-2.5-flash-lite` proposed.
4. **Say whether I should build 5C₂/5C₄/5C₅ now** (loader, adapters, runner) so they are ready when
   your recordings are, or wait.

**I will not create provider accounts or handle API credentials** — that is yours to do, and I will
tell you exactly which keys are needed and where to put them.

---

## 12. Status

| Item | State |
|---|---|
| Normalized audio contract | ✅ Built, tested, no carrier names in code |
| `TelephonyProvider.openMediaStream` | ✅ Added |
| Benchmark harness | ✅ Built, **49 tests** |
| Adversarial review | ✅ 3 reviewers — **5 critical defects found** |
| Defects fixed | ✅ All 5, each with a named regression test |
| Test suite | ✅ **445 passing**, 20 suites |
| Lint / typecheck | ✅ Clean |
| Corpus loader / adapters / runner | ⬜ **Not built — 5C₂, 5C₄, 5C₅** |
| Provider SDKs installed | **None** |
| Provider selected | **None** |
| Telephony contract | **None** |

Awaiting your approval of the protocol and thresholds.
