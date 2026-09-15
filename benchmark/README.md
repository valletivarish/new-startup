# Phase 5C Benchmark Harness

A measuring instrument for choosing speech-to-text and text-to-speech providers.
**It ranks providers. It does not select one.** Selection is a founder decision gate.

**This package is not production code.** It lives outside `apps/` and `packages/` so that
provider-specific code cannot reach production by an ordinary import, and
`apps/api/test/production-boundary.test.ts` fails the build if that boundary is crossed.

---

## Quick start

```bash
pnpm --filter @platform/benchmark bench doctor
```

**Before any of this, on the benchmark VM:**

```bash
export BENCHMARK_REGION=BLR1     # Bangalore. A spending run refuses to start without it.
```

The location is part of the pre-registered protocol, not an operational detail: the host's
network position is added to every measurement, and a result that cannot be tied to where it
ran cannot be compared with the 1200 ms budget. It is **declared**, never verified — nothing
inside the process can prove where a machine is.

Then, in order:

```bash
# 0. Generate the recording slots, worksheet and consent block. Contacts nothing.
pnpm bench scaffold --out corpus/pilot --speakers spk-mh-01,spk-ka-01 --corpus-version pilot-1
pnpm bench consent  --manifest corpus/pilot/manifest.json
# ... record, fill references.tsv in a spreadsheet, then:
pnpm bench reference --manifest corpus/pilot/manifest.json --sheet corpus/pilot/references.tsv

# 1. Check the environment: ffmpeg codecs, credentials, and the declared region.
pnpm bench doctor

# 2. Validate the corpus. Makes NO provider calls and costs nothing.
pnpm bench validate --manifest corpus/example/manifest.json

# 3. See exactly what a sweep would execute and spend. Still no provider calls.
pnpm bench plan --manifest corpus/example/manifest.json

# 4. Dry run one provider. Prints the call count and stops.
pnpm bench run --manifest corpus/mine/manifest.json --kind stt --adapter sarvam

# 5. Same command with --confirm actually spends.
pnpm bench run --manifest corpus/mine/manifest.json --kind stt --adapter sarvam --confirm

# 6. Render a stored run.
pnpm bench report --run runs/phase-5c-stt-sarvam

# 7. Pool the two protocol passes into one sample, and get the pooled verdict.
pnpm bench pool --runs runs/pass-1-stt-sarvam,runs/pass-2-stt-sarvam

# 8. Build the blind listening pack from the drained TTS runs.
pnpm bench quality-pack --runs-dir runs --seed 42
```

Nothing spends money without printing the call count first and requiring `--confirm`.

---

## Credentials

Put provider keys in the repo root `.env` only (gitignored).
`benchmark/.env.benchmark` is a symlink to that file. The CLI loads `.env`
automatically; a variable already set in the shell still wins. The harness never
reads a key into a log, a report, or a stored result — `redact()` runs on everything
written to disk.

| Adapter | Variables |
|---|---|
| `sarvam` | `SARVAM_API_KEY` (optional: `SARVAM_STT_MODEL`, `SARVAM_TTS_MODEL`, `SARVAM_TTS_SPEAKER`) |
| `deepgram` | `DEEPGRAM_API_KEY` (optional: `DEEPGRAM_MODEL`) |
| `azure` | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (optional: `AZURE_TTS_VOICE`, `AZURE_TTS_VOICE_HI`) |
| `cartesia` | `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID` (optional: `CARTESIA_MODEL`, `CARTESIA_VERSION`) |
| `gemini` | `GEMINI_API_KEY` (optional: `GEMINI_MODEL`) — **use a PAID key**, see below |

**The LLM is a processor.** It receives the speech-to-text transcript, so it needs a
credential, appears in the consent form, and is subject to the same disclosure rules as the
speech vendors. Google's unpaid tier trains its products on your input and permits human
review, which is incompatible with informed consent for recorded speech.

Every variable an adapter reads must appear in the registry's `REQUIRED_ENV` or
`OPTIONAL_ENV`, and a test enforces it. A hard requirement missing from that table
means the pre-flight passes, the run starts, and every call fails — producing a run
directory full of failures for a provider that was never contacted.

Azure TTS uses a **separate Hindi voice**. Synthesising the code-mixed lines with an
`en-IN` voice would measure a mismatch we chose, and the listening gate would then
reject the provider for our own setup.

`AZURE_SPEECH_REGION` is required rather than defaulted: silently using a US region would
measure a transatlantic round trip and attribute it to the provider.

`CARTESIA_VOICE_ID` is required for the same class of reason — voice choice materially
affects the quality gate and must be a deliberate decision.

---

## The corpus

`corpus/example/` is a **template**. Its audio is synthetic tones, not speech, and a run
against it cannot produce a provider decision. It exists so `validate` and `plan` can be
exercised before any recording session, and so real recordings drop into a known shape.

### Recording specification

| Setting | Value | Why |
|---|---|---|
| Format | 16 kHz (or higher) mono 16-bit WAV | Never record at 8 kHz — the clean reference cannot be recovered afterwards |
| Loudness | normalise to about −23 LUFS | Unnormalised audio makes provider AGC behave differently for reasons unrelated to the provider |
| Leading silence | ≤ 200 ms | Otherwise every latency figure for that utterance is inflated |
| Structure | continuous 5–6 answer conversations | The runner accumulates conversation context across turns |
| Environments | record the script twice: quiet, and genuinely noisy | Noise mixed in afterwards is a simulation and must be labelled as one |

`validate` checks all of this and will tell you which file is wrong and why.

### Consent is mandatory and enforced

Recordings are voice samples of real people — personal data under the DPDP Act. The
manifest schema **requires** `coversCrossBorderTransfer: true` and a list of disclosed
processors, because several candidate providers process outside India. A consent that
does not cover transfer makes the corpus unusable for them, and re-consenting means
re-contacting every participant.

`corpus/**/*.wav`, `runs/` and `reports/` are gitignored. Manifests are committed;
audio and run output never are.

---

## Audio conditions

| Condition | How it is produced | Role |
|---|---|---|
| `clean_16k` | as recorded | Upper bound. Diagnostic only. |
| `narrowband_8k` | **real codec round trip** via ffmpeg, then G.711 μ-law | The deciding condition |
| `narrowband_8k_noisy` | same, from the noisy recordings | Robustness |
| `live_pstn` | real calls through a carrier | The only genuinely real one — pilot |

The narrowband condition uses the **best real narrowband encoder this ffmpeg can produce**,
in preference order: `libopencore_amrnb` → `amr_nb` → `adpcm_g726`. AMR-NB is what an
Indian mobile actually uses, so it is preferred; most stock ffmpeg builds ship it as
**decode only**, and `bench doctor` tells you which you have.

If no narrowband encoder exists, the condition **refuses to run** rather than silently
degrading to a linear downsample and calling the result narrowband. Whichever codec was
used is recorded in the run metadata and printed in every report.

> Install an ffmpeg with `libopencore-amrnb` for the closest approximation to the mobile
> radio leg. With `adpcm_g726` you still get a real ITU-T narrowband codec, but it is not
> the mobile one — note the substitution when reading results.

---

## What is measured, and what the numbers mean

### STT

The gated figure is **post-endpoint residual latency**: from the moment the last audio
frame is handed over (which on a live call is when the VAD fires) to the last final
transcript.

It is deliberately **not** request-start-to-response. That number is dominated by
utterance length and upload speed, and it erases streaming STT's entire production
advantage — a streaming provider has already processed everything but the last fragment
when the endpoint fires. Wall-clock request time is reported separately, for context.

Audio is fed at **real time**, frame by frame, because that is the only way the residual
figure means what the budget says it means.

Reports include a **bias check**: the correlation between utterance duration and residual
latency. A high correlation means the figure is tracking how long someone spoke rather
than how long the provider took, and the report says so.

### TTS

The gated figure is **time to first byte**. **First audible byte** is measured separately,
because a provider that emits 200 ms of silence immediately would otherwise look instant.

By default the stream is **not drained** — the gate measures the first byte, and reading
the rest transfers audio nobody looks at. **Be precise about what this saves:** for the
endpoints implemented here it saves time and bandwidth, not quota. These are
per-character-billed request/response APIs, so the synthesis is paid for the moment the
request is accepted; only a genuinely cancellable streaming endpoint billed by delivery
would save money. Use `--drain` when you need real-time factor or audio for the listening
gate — a drained run keeps its audio, which is what `quality-pack` reads.

Audibility is measured from the **bytes**, never from a flag the adapter sets. An adapter
asserting every chunk is audible would collapse first-audible onto first-byte and silently
disable the leading-silence check.

### Accuracy

WER and CER, plus **entity accuracy** — did the specific facts a screening call exists to
collect survive transcription. Facts are scored three ways:

- **found** — captured
- **missing** — absent; the agent re-asks. Recoverable.
- **wrong** — heard as something else; **silently rejects a qualified candidate**

Entities are matched by kind. Numbers, durations and money use whole-token-run matching,
so `"19 years"` never satisfies `"9 years"`. Phone numbers compare whole digit runs — after
normalisation, so spelled-out digits score the same as numerals — and a longer number never
satisfies a shorter expectation by containing it. Names tolerate transliteration variance.
`reject` forms express negation, because an accept-list cannot: `"I cannot relocate"`
contains `"relocate"`.

**Number normalisation runs both ways.** A provider asked for inverse text normalisation
returns `120000` where the reference says "one hundred twenty thousand"; a word-by-word
table cannot bridge that, so the same correct recognition scored WER 0.44 from one provider
and 0.00 from another. Spoken multipliers are folded to a canonical value on both sides
(`twelve lakhs` = `12,00,000` = `1200000`), and digit-group separators are stripped before
tokenising. Folding applies **only** to runs containing a multiplier, so `"3 30"` stays a
time rather than becoming thirty-three.

Every STT adapter is additionally required to request the **same text normalisation**
(`verbatim`), and a test enforces it. Asking one provider for ITN and another for lexical
output compares request options, not providers — on a gate that can FAIL a run.

---

## The decision rule

Pre-registered in `src/measure/verdict.ts` and applied mechanically. A threshold chosen
after seeing the numbers is not a threshold.

```
totalTurnP50Ms      1200   HARD GATE (end-to-end runs)
totalTurnP95Ms      2000   HARD GATE (end-to-end runs)
maxWer              0.25   HARD GATE (STT runs)
minEntityAccuracy   0.90   HARD GATE (STT runs, pooled)
Hinglish sub-gate   0.85   HARD GATE (code-mixed subset only)
maxHardFailures     1      HARD GATE (a COUNT, not a rate)

sttP50Ms             300   design budget — attribution only
llmFirstTokenP50Ms   500   design budget
ttsFirstByteP50Ms    300   design budget

DERIVED COMPONENT GATES — binding on the runs you can actually execute
stt            p50 400 / p95 1200   = total − (llm 500 + tts 300)
tts_first_byte p50 400 / p95 1200   = total − (stt 300 + llm 500)
```

**Stage budgets are advisory attribution.** They sum to 1100 ms; gating on all of them at
once would silently impose a tighter total than the 1200 ms actually pre-registered.

**A component gate is not a stage budget.** A component run measures one stage and has no
total by construction, so it is gated at the point past which that stage *alone* cannot fit
inside the pre-registered total even if every other stage hits its budget exactly. That
figure is derived from the total, imposes nothing tighter than it, and is **binding**.
Without it, a provider with a 5 s residual and one with 150 ms received the same verdict —
which is what this harness did until it was reviewed.

**An STT run carries the accuracy gates; a TTS run does not.** A TTS run has no transcript,
so handing it the WER and entity gates made every TTS run permanently INCOMPLETE for a
reason no provider could ever satisfy.

**A missing code-mixed subset is INCOMPLETE, not a warning** — consistent with every other
missing measurement. A run that never tested code-mixed speech has not earned a PASS on
Indian recruitment audio.

**A 4xx is our defect, not the provider's.** Every real adapter here was written from
documentation, so the likeliest first-contact outcome is a wrong request shape. Those are
excluded from the failure gate and make the run INCOMPLETE: this run did not measure the
provider.

**Failures are counted, not rated.** At 30 turns a 2% rate is unreachable — one transient
429 is 3.3% — so a rate gate would fail providers for network weather.

**Verdicts are `PASS` / `FAIL` / `INCOMPLETE`.** A run may FAIL on few samples (a breach
already happened) but may only PASS with enough of them.

---

## The blind listening gate

Latency alone must not choose the voice. Build the pack from a drained TTS run:

- audio files are named `sample-001.wav` and carry **no provider information**
- presentation order is shuffled from a **recorded seed**, so it is reproducible
- the scoring sheet shows the intended **text** (you cannot judge pronunciation without
  it) but never the provider
- the mapping is written **outside** the listener's folder, so handing over the folder
  cannot leak it

Gate: **any candidate that 2 of 3 listeners mark unacceptable is excluded**, before the
cheapest-passing tiebreak. Rejections are counted per **listener**, not per sample.

---

## Results layout

```
runs/<run-id>/
  metadata.json   what ran, with which code, against which corpus
  raw.jsonl       one row per measurement, append-only, written as results arrive
  metrics.json    aggregates — all recomputable from raw.jsonl
  errors.json     every failure, categorised
  report.md       written by `bench report`
```

**Raw first.** If the process dies mid-sweep, everything already paid for survives. Every
aggregate can be recomputed from `raw.jsonl`, which is what makes a verdict auditable
rather than asserted.

**Runs are never overwritten.** An existing run directory is an error.

`metadata.json` records corpus version, audio condition, per-utterance input checksums,
adapter version, model, whether the adapter is unverified, retry budget, seed, Node
version, platform, git commit and whether the working tree was dirty.

---

## Cost control

- `validate` and `plan` make **no** provider calls
- `run` without `--confirm` prints the call count and stops
- `--max-calls` counts **provider calls, retries included** — not cases. The run records
  that it stopped, in both the STT and TTS sweeps
- unknown flags are an **error**, and a non-numeric budget is an error: a mistyped ceiling
  must never silently become the default
- `--key=value` and `--key value` both work; only one of them used to
- `run` validates the corpus **before** spending and refuses an invalid one unless
  `--ignore-corpus-errors` is given. A silent recording scores every provider as failing,
  and you would have paid for it first
- expired consent aborts loading, not just validation
- retries are bounded and **only** on transient transport faults
- `auth` and `quota` errors **stop the sweep** rather than being retried — retrying a bad
  key wastes time, and retrying past a quota wall spends money that is gone
- TTS stops at the first byte unless `--drain` is passed

---

## What changed after the 2026-08-24 verification and bias review

Four adapters were checked field by field against their providers' current official
documentation, and the harness was attacked by an adversarial review across ten named bias
categories. **Every adapter needed changes and 35 of 36 findings were confirmed.** The ones
that would have chosen the winner:

- **Script.** Each STT adapter is asked for its own documented configuration on code-mixed
  audio, and those configurations return different alphabets. A flawless Devanagari
  transcription scored **125% word error** against a romanised reference. Scoring is now
  script-aware: a hypothesis is compared against a reference in the same alphabet, the
  manifest carries `referenceAlt`, and a cross-alphabet comparison is **UNSCOREABLE** —
  excluded, never a FAIL.
- **Language codes.** The sweep hard-coded `en-IN` for code-mixed audio for everybody. One
  provider documents `multi` for code-switching. Mapping now lives on the adapter, from its
  own docs, and is recorded in run metadata.
- **Our bugs, their score.** A 200 OK we could not parse was filed against the provider; at
  `maxHardFailures: 1`, two of them printed a red FAIL for a service that answered every
  question correctly. Unparseable responses are now `response_shape_unrecognised`, an
  adapter defect, and make the run INCOMPLETE.
- **Streaming vs buffered.** The same 400 ms first-byte gate was applied to an adapter that
  buffers the whole response, whose "first byte" is full synthesis. That figure is now
  reported as **not comparable** rather than passed or failed.
- **Serial vs streaming pipeline.** The end-to-end run awaited the whole completion before
  synthesising, charging `total_turn` for however long the model kept talking. Synthesis now
  starts at the first sentence boundary, concurrently.
- **Consent.** `disclosedProcessors` was a required field that nothing read. A sweep now
  refuses to contact any provider not named in **every** speaker's consent.
- **Format fairness.** Asking one TTS provider for 16 kHz and levelling it down for the
  listening gate does not remove a fidelity bias, it reverses it — our resampler adds
  artefacts a natively-8 kHz provider never suffers. Every TTS adapter now requests a
  documented 8 kHz format, so nothing is resampled to be heard.

## Known limitations

Stated so results are read correctly rather than over-trusted.

1. **The real provider adapters are UNVERIFIED.** They were written from published
   documentation and have never been exercised against a live service, because no
   credentials exist in this repository. The flag is stored in run metadata and printed
   in every report.
2. **The real adapters are batch, not streaming.** A speculative websocket client with
   guessed authentication would fail in ways that look like provider unreliability, and
   the benchmark would attribute those bugs to the provider. So **streaming residual
   latency cannot yet be compared across real providers** — the harness measures it
   correctly (the fakes prove that), but verified streaming vendor code is missing.
3. **Endpointing and barge-in cannot be measured offline.** Recorded utterances have
   pre-cut boundaries. Both are pilot work.
4. **Resampling is linear interpolation** with averaging on downsample — adequate for
   measurement, not for production audio quality.
5. **Entity accuracy depends on the expectations you write.** Write them once, review
   them, freeze them before any run.
6. **One run is one sample of a provider's day.** Run each provider twice at different
   times and pool the samples before trusting a close result.
7. **Even the narrowband condition is an approximation.** It omits handset noise
   suppression, AGC, packet loss and concealment. Only `live_pstn` is the real thing.
8. **The end-to-end run is designed but not implemented.** `plan` lists it and marks it
   NOT YET EXECUTABLE, and excludes it from the totals. Until it exists, `total_turn` is
   never measured and only the derived component gates apply — so the 1200 ms headline
   number is not yet a thing this harness has tested against.
9. **`--max-calls` bounds calls, not spend.** It cannot know a provider's price. Use
   `plan`, which reports worst-case audio seconds and characters — the units providers
   actually meter — for both protocol passes.
10. **The residual includes our own upload.** All three STT adapters are batch: they drain
    the paced stream, build a WAV and POST it, all after the endpoint mark. Conversion and
    upload are therefore inside the measured residual. It affects all three roughly equally
    — a systematic overstatement, not a bias between providers — but it means the absolute
    figure is not a streaming provider's true residual. Verified streaming adapters would
    fix it; none exists, because none of the three protocols is documented well enough to
    implement without guessing the wire framing.
11. **Cost cannot be ranked for every provider.** At least one candidate publishes no
    per-character price anywhere, so it comes out NOT PRICED: rankable on latency and
    quality, not on cost.

---

## Tests

```bash
pnpm --filter @platform/benchmark test
```

The suite validates **the instrument**, not just the fakes. Its fakes are deliberately
hostile — they consume audio progressively, pause mid-utterance, emit several finals,
delay first byte, require draining, and fail in categorised ways. An earlier version of
this harness passed 38 tests while carrying five critical defects, because its fakes were
polite. That is the failure mode these tests exist to prevent recurring.

`test/regressions.test.ts` is the second round of that lesson: every test in it names a
defect that existed, passed the previous suite, and would have produced a confidently wrong
provider decision — an ungated latency figure, a TTS run that could never pass, a blind
listening gate no code path could produce, a budget flag that silently did nothing.
