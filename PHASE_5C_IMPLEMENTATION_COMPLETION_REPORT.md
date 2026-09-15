# Phase 5C — Benchmark Harness Implementation: Completion Report

**Date:** 2026-08-23
**Scope:** build a reproducible experimental system for comparing speech providers.
**Not in scope:** choosing one.

> **No provider has been selected and no production provider integration has been
> implemented.**
>
> This statement is true after Phase 5C and is enforced mechanically, not by intent:
> `apps/api/test/production-boundary.test.ts` fails the build if a provider name appears in
> production code, if production imports the benchmark package by name or by relative path,
> if a production `package.json` depends on it, if the benchmark moves under `apps/` or
> `packages/`, or if any provider SDK is installed anywhere in the repository.

---

## 1. What this phase was for

The Phase 5B validation round ended with providers ranked on **published prices and
documented claims**. Nothing had been measured. The founder's approval was explicit about
what that did and did not authorise: *approve the architecture and the benchmark phase; do
not approve Sarvam as the production provider; do not sign a telephony contract.*

So the deliverable is an instrument, and the standard it is held to is not "the code runs"
but **"a number this produces can be trusted to decide something irreversible."** A
benchmark that is wrong is worse than no benchmark: it launders a guess into a measurement
and attaches a verdict to it.

---

## 2. Implemented

All of this exists, compiles under `strict`, lints clean, and is covered by tests.

### 2.1 The measurement boundary the founder asked for

`packages/providers/src/voice.ts` — `NormalizedAudioFrame`, `AudioFormat`, `MediaStream`,
`AudioCodec`, `VoiceActivityDetector`. Interfaces only, no implementation, no provider
named. The research showed five candidate carriers disagree on the wire format (μ-law
8 kHz, linear16 at a selectable rate, base64-in-JSON); an adapter's job is to turn any of
them into one shape on the way in and back on the way out. Endpointing is a first-class
interface because it is the largest tunable component of perceived latency and it sits
*before* STT — it must be measurable and swappable independently of the STT vendor.

### 2.2 Corpus

Zod-validated manifest; loader; `validateCorpus` that makes **no provider calls and costs
nothing**. It checks consent presence and expiry, sample rate, duration bounds, silence,
clipping, loudness, leading silence, duplicate ids, and entity satisfiability — an
expectation no perfect transcription could satisfy is an error, because it would otherwise
be scored against every provider. Manifest paths are treated as untrusted data: they must
be relative and must resolve inside the corpus directory.

### 2.3 Audio conditioning

G.711 μ-law, PCM, resampling, strict RIFF parsing. The deciding condition is a **real
narrowband codec round trip** through ffmpeg, preferring `libopencore_amrnb` → `amr_nb` →
`adpcm_g726`. If no narrowband **encoder** exists, the condition **refuses to run** rather
than degrading to a linear downsample and calling the result narrowband. Which codec was
used is recorded per row, in run metadata, and printed in every report.

### 2.4 Measurement

- **STT: post-endpoint residual latency** — from the moment the last audio frame is handed
  over to the last final transcript. Deliberately *not* request-start-to-response, which is
  dominated by utterance length and erases streaming's entire production advantage. Audio
  is fed **at real time, on a schedule**, because that is the only way the figure means
  what the budget says it means. Wall-clock request time is reported separately.
- **TTS: time to first byte**, with **first audible byte** measured separately from the
  bytes themselves — a provider emitting 200 ms of silence immediately would otherwise look
  instant.
- **Accuracy**: WER, CER, and kind-aware entity scoring that distinguishes `found` /
  `missing` / **`wrong`**. A missing notice period makes the agent re-ask; a wrong one
  silently rejects a qualified candidate.
- **Failures**: categorised, counted (never rated), with bounded retries on transient
  transport faults only. `auth` and `quota` stop the sweep rather than being absorbed as
  provider unreliability.

### 2.5 Runners, persistence, reporting

Seven-run design (3 STT + 3 TTS + 1 end-to-end), not a 3×3 cross product. **Raw first**:
every measurement is appended to `raw.jsonl` as it completes, so a crash mid-sweep leaves
everything already paid for on disk, and every aggregate is recomputable from it. Runs are
never overwritten — enforced by the filesystem, not by a check. Metadata records corpus
version, condition, codec, per-utterance input checksums, delivered checksums, adapter
version and configuration, retry budget, seed, Node version, platform, git commit and
whether the tree was dirty.

### 2.6 Blind listening gate

Latency alone must not choose the voice: for an outbound screening call the voice *is* the
product surface and it is the least reversible half of the decision. Opaque `sample-NNN`
filenames, presentation order shuffled from a recorded seed, scoring sheet showing the
intended text but never the provider, mapping written **outside** the listener's folder.
Gate: any candidate 2 of 3 listeners mark unacceptable is excluded, before any
cheapest-passing tiebreak.

### 2.7 Cost control

`validate` and `plan` contact nothing. `run` prints the call count and stops without
`--confirm`. `--max-calls` counts provider calls with retries included. Unknown flags and
non-numeric budgets are errors. `plan` reports worst-case audio seconds and characters —
the units providers actually meter — alongside the call count.

---

## 3. Tested and verified

| Check | Result |
|---|---|
| Benchmark suite | **190 passed** across 8 files |
| API suite (Testcontainers, real PostgreSQL) | **401 passed** across 20 files |
| Production-boundary tests | **6 passed** |
| `pnpm -w lint` | clean |
| `pnpm -w typecheck` | clean, all 6 projects |
| `bench doctor` | reports ffmpeg 8.1, `adpcm_g726`, warns it is **not** the mobile codec, lists all four adapters as MISSING credentials |
| `bench validate` | example corpus: 4 utterances, 0 errors, 0 warnings |
| `bench plan` | 6 executable runs + 1 marked NOT YET EXECUTABLE; real durations; worst-case metered units; warns the 4-utterance corpus cannot reach a verdict |
| `bench run` without credentials | refuses, and says it will not fabricate a result |
| `bench run` with a dummy credential, no `--confirm` | prints the count, stops, creates no run directory |
| `--max-call` (typo) | rejected as an unknown flag |
| `--max-calls=7` | parsed; ceiling honoured |
| Full round trip on **fakes** | STT: 4 samples, residual p50 220 ms, 0 failures, FAIL on WER — correct, the fake answers "hello there" to everything. TTS: 20 samples, first byte p50 120 ms, first audible 160 ms, **PASS**. |
| `quality-pack` | 20 opaque samples + scoring sheet; no provider name anywhere in `listen/`; mapping outside it |
| Re-running a run id | refused (`RunExistsError`), existing data intact |

**No provider was contacted at any point.** No credentials exist in this repository.

---

## 4. The adversarial review, and what it found

A four-agent adversarial review (bias / measurement / boundary+secrets / cost+operational
reality) was run against the implemented harness. Two of the four returned
**NOT_TRUSTWORTHY**. Every finding below was verified against the code before being fixed;
each has a named regression test in `benchmark/test/regressions.test.ts`.

**The harness had passed 150 tests while carrying all of these.**

### Critical — the decision rule could not fail anything the CLI could run

1. **The headline latency gate was a no-op for every executable run.** The comparison was
   wrapped in `else if (headlineStage === 'total_turn')`. Component runs pass `'stt'` or
   `'tts_first_byte'`, for which the block confirmed samples existed and compared nothing.
   The only latency check they received was an advisory warning. A provider with a 5 s
   residual and one with 150 ms got the same verdict — nullifying the entire real-time
   pacing design at the decision step. *Fixed:* binding component gates derived from the
   total minus the other stages' budgets (400 ms p50), so they can never impose a total
   tighter than the 1200 ms pre-registered. §6.0 of the design document records the change.

2. **A TTS run could never reach a verdict.** Two independent causes: the frozen line set
   was 10 lines against a sample floor of 20, and TTS runs were handed the WER and entity
   gates they can never satisfy. Three TTS sweeps would have cost 30 billed syntheses and
   returned three identical INCOMPLETEs. *Fixed:* 20 lines; per-run-kind thresholds; `plan`
   now warns when a line set cannot reach the floor.

### Major — our own bugs would have been recorded as the provider's

3. **`classify()` had no branch for 4xx other than 429.** A 400 from a wrong request shape
   — the likeliest first-contact outcome for four adapters written from documentation —
   fell through to keyword matching on the provider's own error body, and audio APIs say
   "audio"/"format"/"sample rate" in their 400s. It was filed as the provider rejecting our
   audio, and two of them produced a FAIL. *Fixed:* `client_request_error`, excluded from
   the failure gate, making the run INCOMPLETE instead.

4. **`CARTESIA_VOICE_ID` was hard-required inside the adapter but absent from
   `REQUIRED_ENV`.** `doctor` reported Cartesia green, the run started, every line threw an
   unclassifiable error, and the result was a completed run directory with 10 hard failures
   and a red FAIL for a provider that was never contacted — plus a poisoned run id that
   cannot be reused. *Fixed:* declared; `MissingCredentialsError` now classifies as `auth`
   and stops the sweep; a test asserts every variable any adapter reads is declared.

5. **The three STT adapters asked for three different text normalisations.** Deepgram was
   sent `smart_format`, Azure's ITN'd `DisplayText` was read, Sarvam got neither — and the
   scorer's normaliser was one-way. Measured: the same correct recognition scored WER 0.44
   from one and 0.00 from another. WER is one of only two gates that can FAIL a run.
   *Fixed:* all three request verbatim output (a test enforces it), and normalisation is
   two-way — multiplier folding and digit-group stripping, so `twelve lakhs`, `12,00,000`
   and `1200000` compare equal, while `"3 30"` stays a time.

6. **The blind listening gate was unreachable.** `quality-pack` was documented in two
   places and implemented in neither; and nothing produced audio for it, because the sweep
   never asked to keep the bytes. `--drain` would have paid for full synthesis and
   discarded every byte. The TTS choice would then have been made on latency alone —
   exactly what the gate exists to prevent. *Fixed:* the CLI is a dispatch table with help
   generated from it, so a documented-but-unimplemented command is now impossible; drained
   runs persist audio; `quality-pack` builds the pack.

7. **Pacing was cumulative, not scheduled.** The consuming adapter's own cost was added to
   the audio timeline instead of absorbed by it — measured at 222 ms of free head start for
   a 3 ms/frame consumer over one second of audio, against a 300 ms budget, and
   provider-dependent. *Fixed:* absolute-deadline scheduling; a regression test feeds the
   same audio to a 0 ms and a 3 ms consumer and asserts the timelines agree.

8. **Breaking out of the TTS stream leaked the request.** `streamBody` never cancelled the
   reader, so the body stayed locked and un-consumed. There was also no timeout anywhere,
   making the `timeout` failure category unreachable. *Fixed:* `finally { reader.cancel() }`
   (tested against a real local server that observes the client disconnect), per-attempt
   `AbortController`, per-case timeouts. **The comment claiming this saved quota was also
   wrong and is corrected:** these are per-character-billed request/response APIs, so
   not draining saves time and bandwidth, not money.

9. **Budget flags could be silently ignored.** `--max-calls=20` was parsed as a key named
   `"max-calls=20"` and the ceiling stayed at 500. A non-numeric value became `NaN`, which
   disabled the ceiling entirely and made the retry loop unbounded against a rate-limited
   endpoint. And the ceiling counted *cases*, not calls: with the defaults the real limit
   was 1500 billed calls, three times the number printed above `--confirm`. *All fixed*,
   with tests.

10. **`plan` was wrong in both directions at once** — it counted an end-to-end run no code
    path can execute (a 50% overstatement) while ignoring retries in the two figures a
    founder actually prices against, and estimated every utterance at half the manifest
    maximum (30 s for a 4 s recording). *Fixed:* real durations, worst-case metered units,
    unexecutable runs marked and excluded.

11. **`run` never validated the corpus.** A silent recording scores every provider as
    failing and an over-long lead-in inflates every latency figure — both paid for in full,
    then attributed to the provider. Expired consent was checked only in the optional
    `validate` command. *Fixed:* `run` validates first and refuses unless
    `--ignore-corpus-errors`; `loadCorpus` re-checks consent expiry and throws.

12. **Retried samples were excluded from accuracy as well as latency**, and
    `timeline.retries` was always 0 because the counter landed on a recorder that was
    immediately discarded. *Fixed:* a retry changes when the answer arrived, not what it
    said, so transcripts are scored; retries are counted outside the recorder.

13. **Smaller, all fixed:** `metrics.json` was the one artifact written without redaction;
    run-directory creation was a TOCTOU (`existsSync` then `mkdir recursive`, which does
    not throw); the residual-vs-duration bias check paired two arrays by index that could
    desynchronise; a 429 whose body mentioned quota aborted the sweep; a zero-length chunk
    counted as a first byte; the adapter could assert `audible: true` and disable the
    leading-silence check (the flag is now gone from the interface); an adapter that
    abandoned the audio produced a flatteringly small residual (now a failure); Sarvam's
    base64 WAV was fed on as raw PCM, header included; Azure TTS synthesised the Hindi
    lines with an English voice; the path-containment check exempted absolute paths and
    used a bare prefix test; run output written outside `benchmark/` was not gitignored;
    and the production-boundary vendor list omitted `azure` and `microsoft` while its own
    comment stripper deleted everything after the `//` in a URL.

---

## 5. Not tested, because credentials or corpus were unavailable

Stated plainly, because these are the gaps between "the instrument is built" and "the
instrument has been used."

1. **No provider has been contacted.** No credentials exist in this repository and none
   were requested. Every real adapter is flagged `unverified: true`; that flag is stored in
   run metadata and printed as a prominent block in every report.
2. **The four real adapters are written from documentation and are batch, not streaming.**
   A speculative websocket client with guessed authentication would fail in ways that look
   exactly like provider unreliability, and the benchmark would attribute my bugs to the
   vendor. So **streaming residual latency cannot yet be compared across real providers.**
   The harness measures it correctly — the fakes prove that — but verified vendor code is
   missing and needs credentials.
3. **The end-to-end runner does not exist**, so `total_turn` — the 1200 ms headline the
   whole budget is written around — has never been measured. `plan` marks the run NOT YET
   EXECUTABLE and excludes it from totals.
4. **No real corpus exists.** `corpus/example/` is synthetic tones, not speech, and cannot
   produce a provider decision. Recording needs consented Indian speakers across quiet and
   noisy environments, and at 4 utterances the example corpus is below the sample floor —
   `plan` and `run` both say so.
5. **Endpointing and barge-in cannot be measured offline.** Recorded utterances have
   pre-cut boundaries. Both are pilot work.
6. **This ffmpeg cannot encode AMR-NB**, so the narrowband condition uses G.726 — a real
   ITU-T narrowband codec, but not the mobile radio one. Results stay comparable between
   providers (identical input, checksummed) but are optimistic relative to a real call.

---

## 6. Remaining risks

| Risk | Why it matters | Mitigation in place |
|---|---|---|
| Adapter request shapes are unverified | First contact will produce 4xx errors | They are classified as *our* defect and make the run INCOMPLETE, not a FAIL against the provider |
| Only fakes have exercised the measurement path | Fakes cannot surprise you the way a real API can | The fakes are deliberately hostile — progressive consumption, mid-utterance pauses, several finals, delayed first byte, categorised failures — and 13 of the defects above were found *because* of them |
| The corpus does not exist yet | Entity expectations written after seeing results are not expectations | Write and freeze them before any run; `validate` rejects unsatisfiable ones |
| One run is one sample of a provider's day | A close result could be network weather | Pre-registered: run each provider twice at different times and pool before deciding |
| Component gates are new | They were added after the implementation review, not before the first run | Which is the only acceptable order — they are still pre-registered relative to any run, since **no run has happened** |
| G.726 substitution | Optimistic relative to a real mobile call | Recorded in metadata, printed in every report, flagged in `doctor` |

---

## 7. The next decision gate

Phase 5C delivers an instrument. It has produced **no provider data**, and the founder's
constraint stands unchanged.

Before a benchmark can decide anything, in order:

1. **Record the corpus.** Consented Indian speakers, quiet and noisy, ≥ 20 utterances per
   condition to clear the sample floor, entity expectations written and frozen first.
2. **Verify the adapters** against real credentials — one utterance each, checking the
   request shape, before any sweep. Clear `unverified` only when it has actually run.
3. **Implement the end-to-end runner**, or accept that `total_turn` stays unmeasured and
   the decision rests on component gates alone.
4. **Run the 7-run sweep twice**, at different times of day, and pool.
5. **Build the blind listening pack** and score it with three listeners before looking at
   any latency table.
6. **Then, and only then, bring a provider recommendation to the founder** — which remains
   a founder decision, not an output of this harness.

The regulatory gate ordering the founder set is unchanged and sits ahead of any launch, not
ahead of this benchmark.

---

*Every number in this report was produced by running the code, not by reading it. Where
something was not run, this report says so.*
