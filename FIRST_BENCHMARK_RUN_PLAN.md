# First Benchmark Run — Execution Plan

**Nothing in this plan has been executed. No provider has been contacted.**

The plan exists so the first authenticated request is a deliberate, cheap, scripted check
rather than a full sweep that discovers a wrong header expensively. Twelve questions cannot
be answered from documentation (see `PROVIDER_ADAPTER_VERIFICATION_REPORT.md` §5), and every
one of them is cheaper to answer with one utterance than with fifty-five.

---

## Stage 0 — Free, offline, no credentials

Nothing here contacts a provider or costs anything.

```bash
pnpm --filter @platform/benchmark test          # 267 tests
pnpm bench doctor                               # ffmpeg codecs + which credentials are set
pnpm bench validate --manifest corpus/mine/manifest.json
pnpm bench plan --manifest corpus/mine/manifest.json --rates rates.json
```

**Do not proceed while `validate` reports errors.** `run` now refuses an invalid corpus
anyway, because a silent recording scores every provider as failing and you would have paid
for it first.

`plan` prints the call count, the audio seconds and the characters — **for two passes**,
because the pre-registered protocol runs each stack twice and pools. Anything without a
verified rate prints `NOT PRICED` and the total is labelled a floor.

**Exit criteria:** 0 corpus errors · the plan's spend is one you accept · every line you
care about is priced from an OFFICIAL rate.

---

## Stage 1 — First contact: one utterance and one line per provider

**This is the only stage whose purpose is to find out that we are wrong.**

Run each adapter against a corpus of exactly **one** utterance and the TTS line set trimmed
to **one** line, and one LLM completion. **Total: 7 provider calls** — 3 STT + 3 TTS + 1
LLM. Then read `raw.jsonl` by hand.

*(This said 6 before the LLM was chosen. Gemini is now registered, it is the constant in the
end-to-end run, and its hand-written SSE parsing has never met the real service — so it is
exactly the adapter Stage 1 exists to check.)*

```bash
pnpm bench run --manifest corpus/smoke/manifest.json --kind stt --adapter sarvam --confirm
```

Check, for each, in this order:

1. **Did it authenticate?** A 401 stops the sweep by design. For Cartesia this is the most
   likely first failure — the auth header was corrected from `X-API-Key` to
   `Authorization: Bearer` on documentation that disagrees with itself.
2. **Did the response parse?** A `response_shape_unrecognised` failure is OUR field name
   being wrong, is excluded from the failure gate, and makes the run INCOMPLETE. Fix the
   adapter, bump its `adapterVersion`, and re-run. **Do not** let a mis-parse reach a sweep.
3. **What text form came back?** Compare against the reference by eye. If a provider
   returned inverse-text-normalised text (`120000` where you wrote "one hundred twenty
   thousand") or a different alphabet, stop: that is not a provider difference, it is a
   configuration difference, and it decides the WER gate.
4. **What script did the code-mixed utterance come back in?** The three adapters are asked
   for three different documented configurations. If any returns Devanagari, your manifest
   needs `referenceAlt` for every code-mixed utterance, or that provider's samples will be
   recorded as UNSCOREABLE.
5. **For TTS: what sample rate and encoding actually came back?** Sarvam's adapter now
   throws if the response does not honour the requested rate, because every duration and
   real-time-factor figure divides by the declared one.
6. **Check the provider console.** Compare credits consumed against `plan`'s estimate. That
   is the only way to find out whether an aborted request still bills — which no provider
   documents.

**Exit criteria:** every adapter returns a parseable response in the expected text form and
audio format, `unverified` can be argued down to false, and the console spend matches the
estimate within a factor you understand.

**Cost:** a few rupees. **This stage is where the money is saved.**

---

## Stage 2 — Component runs, one pass

Six runs: 3 STT × the corpus, 3 TTS × the frozen 20-line set.

```bash
for a in sarvam deepgram elevenlabs; do
  pnpm bench run --manifest corpus/mine/manifest.json --kind stt --adapter "$a" \
    --condition narrowband_8k --profile pass-1 --max-calls 200 --confirm
done
for a in sarvam elevenlabs cartesia; do
  pnpm bench run --manifest corpus/mine/manifest.json --kind tts --adapter "$a" \
    --profile pass-1 --drain --confirm
done
```

`--drain` on TTS is needed for the blind listening pack. It does **not** save quota to omit
it for these endpoints — they are per-character billed at request time — so the only cost is
time and bandwidth.

**Read every report before running pass 2.** Look for:

- 🟡 INCOMPLETE with `response_shape_unrecognised` → our adapter, not the provider. Fix first.
- A high **residual-vs-duration correlation** → the residual is tracking how long someone
  spoke rather than how long the provider took.
- **UNSCOREABLE** samples → a corpus gap: no reference in the script that provider returned.
- A TTS run reporting that its first-byte figure is **not comparable** → that adapter buffers
  the whole response, so its "first byte" is full synthesis. It cannot be ranked on this axis
  until its documented streaming endpoint is implemented.

---

## Stage 3 — Second pass, at a different time of day

Identical commands with `--profile pass-2`. Then pool:

```bash
pnpm bench pool --runs "runs/pass-1-stt-sarvam,runs/pass-2-stt-sarvam"
```

**The pooled verdict is the only verdict the pre-registered rule recognises.** Pooling
refuses to combine runs that differ in adapter, corpus version, condition, codec, benchmark
version, retry budget, or per-utterance input checksum — because averaging two different
experiments and reporting one number is exactly the failure this step exists to prevent.

Pooling also gives p95 real resolution: at n=55 the p95 is roughly the third-largest value,
so one outlier decides it. At n=110 it is a tail estimate.

---

## Stage 4 — The blind listening gate

**Before looking at any latency table.** The voice is the least reversible half of the
decision, and a latency-only rule selects the cheapest provider that emits a first byte
inside the budget with no check on what that byte is the start of.

```bash
pnpm bench quality-pack --runs-dir runs --seed 42 --out listening/
```

- Hand `listening/listen/` to **three** listeners. It carries no provider information.
- Keep `listening/blind-mapping.json`. Do not open it in front of a listener.
- The pack refuses to build if providers contributed different lines, or if runs came from
  different profiles or corpus versions — a listener comparing voices on different material
  is scoring the material.
- **Gate: any candidate 2 of 3 listeners mark unacceptable is excluded**, before any
  cheapest-passing tiebreak.

---

## Stage 5 — End-to-end, the leading pair only

**BLOCKED until the founder names the LLM to hold constant.** No LLM adapter is registered.

```bash
pnpm bench run --manifest corpus/mine/manifest.json --kind e2e \
  --stt <leader> --llm <model> --tts <leader> --profile pass-1 --confirm
```

Run it **last**, because "leading" is decided by the component runs — choosing the pair
beforehand is choosing the answer beforehand.

This is the **only** run that measures `total_turn`, the pre-registered gate. The component
gates are necessary conditions derived from it, not sufficient ones: percentiles do not sum,
and no arithmetic over the six component runs produces a p95 total.

The pipeline is **streaming**: synthesis starts at the first sentence boundary while the
model is still generating, which is what a real voice agent does and what the design's own
latency chain describes. A serial pipeline would charge the turn for the model's entire
completion and fail stacks for a shortcut in the harness.

**What `total_turn` excludes:** the carrier leg. There is no phone call here. Add the
media-edge round trip before comparing against a live-call target.

---

## Stage 6 — Apply the rule, mechanically

```bash
pnpm bench report --run runs/pass-1-e2e-<stt>-<llm>-<tts>
```

Then, in this order and no other:

1. Exclude anything the **listening gate** rejected.
2. Exclude anything that **FAILS** the pre-registered thresholds on the **pooled** sample.
3. Among survivors, take the **cheapest**.
4. If none passes, take the closest and **reprice** — do not move a threshold.

> **A threshold changed after seeing the numbers is not a threshold.** If the rule produces
> an answer you dislike, the honest responses are to reprice, to re-record the corpus, or to
> accept the answer. Editing `PHASE_5C_THRESHOLDS` at this point invalidates the whole
> exercise, and the git history will show it.

**The output of this stage is a recommendation to the founder, not a selection.**

---

## Budget and stop conditions

| Guard | What it does |
|---|---|
| `--confirm` | Nothing spends without it. `plan` and `validate` cannot spend at all |
| `--max-calls` | Hard ceiling on **provider calls, retries included**, enforced per turn |
| `auth` / `quota` errors | Stop the sweep immediately rather than retrying |
| Corpus validation | `run` refuses an invalid corpus unless `--ignore-corpus-errors` |
| Consent check | `run` refuses any provider not named in **every** speaker's consent |
| Raw-first persistence | A crash mid-sweep keeps everything already paid for |

**Stop and re-plan if:** any provider's console spend diverges from the estimate by more than
2×; more than a couple of runs come back INCOMPLETE for adapter reasons; or the residual
correlation is high enough that the latency figure is tracking utterance length.

---

## What this plan deliberately does not do

- **Place a phone call.** Carrier latency cannot be simulated honestly. Endpointing, barge-in
  and answer rate are pilot work, behind the regulatory gate.
- **Select a provider.** The harness ranks; the founder chooses.
- **Touch production.** No provider SDK is installed anywhere, no production file names a
  provider, and `apps/api/test/production-boundary.test.ts` fails the build if that changes.
