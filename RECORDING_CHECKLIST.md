# Recording Checklist

**Everything needed to produce the benchmark corpus. Nothing here spends a rupee.**

Phase A (recording readiness) is complete. Phases B–H cannot start: there is no corpus and
there are no credentials. This is the list that unblocks them.

---

## 1. What you need to provide

| # | Item | Why it blocks |
|---|---|---|
| 1 | **Two or more speakers**, from different states | The spec requires regional accent variation. `bench scaffold` refuses a single-speaker corpus — one voice measures how well a provider handles that person |
| 2 | **Pseudonymous speaker ids** (e.g. `spk-mh-01`, `spk-ka-01`) | The manifest is committed to git. Never real names |
| 3 | **A signed consent form per speaker** naming all five processors and their countries | A sweep refuses to contact a processor a speaker was not told about |
| 4 | **A quiet room and a genuinely noisy place** | Noise added afterwards is a simulation and must be labelled as one |
| 5 | **A recorder that produces 16 kHz+ mono 16-bit WAV** | 8 kHz cannot be un-narrowed later; the deciding condition is produced *from* the clean recording |
| 6 | **Five API keys** — Sarvam, Deepgram, ElevenLabs, Cartesia, Gemini | Needed for Phase C, not for recording |
| 7 | **A Bangalore VM (BLR1)** with `BENCHMARK_REGION=BLR1` | A spending run refuses to start without it. Not a laptop |

### Consent wording — the exact processors

Each entry must **begin with the adapter id**, then prose for the person signing:

```
sarvam   — Sarvam AI. Processing location NOT documented by the provider.
deepgram — Deepgram, United States. No India region is available.
elevenlabs — ElevenLabs, United States. No India region is offered.
cartesia — Cartesia. Endpoint region not disclosed; India is enterprise-only.
gemini   — Google LLC (Gemini Developer API). Location NOT documented; may be processed in
           any country where Google maintains facilities. Receives the transcript of your speech.
```

> **The LLM is on that list because it receives the transcript of what was said.** It is a
> processor of personal data exactly as the speech vendors are, and it is the one nobody
> thinks to disclose. Fixing this after a recording session means re-contacting everybody.

---

## 2. What the speakers need to do

**80 recordings, 16 conversations of 5 turns.** Budget a full day including consent, retakes
and writing the references.

| | Count | Notes |
|---|---|---|
| Indian English (`en-IN`) | 20 | 4 conversations |
| Hindi (`hi-IN`) | 15 | 3 conversations |
| **Hinglish / code-mixed** | 20 | 4 conversations — carries its own 85% sub-gate |
| **Noisy re-records** | 25 | 5 conversations, each re-recording a named quiet one, **same words** |

### Rules that the validator enforces

- **≤ 30 seconds per utterance.** Hard limit — one provider's real-time endpoint caps there.
  Target 5–15 s.
- 16 kHz+, mono, 16-bit WAV. Normalise to ≈ −23 LUFS. Trim leading silence to ≤ 200 ms.
- Speak as a **continuous conversation**, not disconnected lines — the end-to-end run carries
  history across the five turns.
- **No profanity.** One provider's default setting has an undocumented effect on the exact
  transcript field this benchmark scores against.

### At least 12 deliberately difficult utterances

Mid-sentence code-switching · English technical terms inside Hindi · one long answer near the
cap · a mid-answer pause of 1–2 s · a self-correction ("fifteen… sorry, eighteen lakhs") ·
one fast and one hesitant answer · filler words · a digit-by-digit phone read-back · a very
short answer ("Haan.") · two regional accents · background speech in the noisy set · a
confusable pair ("nine"/"nineteen").

### The facts each slot must carry — already worked out for you

`bench scaffold` writes a target into every quiet slot's `notes` column, for example
`include: name, duration`. **Follow it and the corpus cannot come up short**: the allocation
sums to exactly the specification's minimums —

```
name 10 · duration 10 · number 10 · money 10 · date 8 · phone 6 · location 8 · text 6  = 68
```

`bench validate` counts them and **refuses** a deciding-sized corpus that is short. That check
did not exist before today; without it a corpus could pass with three dates instead of eight
and nobody would find out until after the sweep.

---

## 3. What comes back

```
benchmark/corpus/<name>/
  manifest.json      consent filled in, dates real, contact real     ← committed
  references.tsv     one row per recording, filled in                ← committed
  audio/conv-01-t1.wav … noisy-05-t5.wav        80 files             ← NEVER committed
```

For each of the 80 rows in `references.tsv`:

| Column | What goes in it |
|---|---|
| `reference` | **Verbatim** — what was actually said, including fillers and self-corrections |
| `referenceAlt` | **Required for every `hi-IN` and `hinglish` row**: the same sentence in Devanagari |
| `entities` | `name\|kind\|accept1/accept2\|unit\|reject1/reject2`, semicolons between entities |
| `codeMixed` | `yes` only where the speech **genuinely** switches language |

**Why `referenceAlt` is not optional:** the three speech-to-text candidates are each asked
for their own documented configuration on code-mixed audio, and those configurations return
**different alphabets**. A romanised reference scored against a Devanagari transcription
reports a *flawless* transcription as a **125% word error rate**. Validation rejects a Hindi
or Hinglish row without a genuine second-alphabet reference.

**Escaping in the entities column:** a delimiter inside a value needs a backslash — write
`CI\/CD`, not `CI/CD`. Unescaped it becomes two separate accept forms, an expectation no
provider can satisfy, scored against all of them, invisible in the output.

---

## 4. Exact commands

```bash
cd benchmark
export BENCHMARK_REGION=BLR1                      # on the BLR1 VM, not a laptop

# Before recording — creates the 80 slots, the worksheet and the consent block.
pnpm bench scaffold --out corpus/pilot --speakers spk-mh-01,spk-ka-01 --corpus-version pilot-1

# Fill in the consent block by hand, then:
pnpm bench consent --manifest corpus/pilot/manifest.json

# ... record into corpus/pilot/audio/, fill references.tsv in a spreadsheet ...

# Merge the worksheet into the manifest. Validates FIRST; leaves the manifest
# untouched if anything is wrong.
pnpm bench reference --manifest corpus/pilot/manifest.json --sheet corpus/pilot/references.tsv

# The full corpus check.
pnpm bench validate --manifest corpus/pilot/manifest.json

# What a sweep would cost. Contacts nothing.
pnpm bench plan --manifest corpus/pilot/manifest.json --rates rates.json
```

**Proceed only when `validate` reports `0 errors`.** Warnings are worth reading; errors are
blocking, and `run` refuses an invalid corpus.

`scaffold` refuses to overwrite an existing `references.tsv` — that file is the day of work,
and regenerating it would replace it with empty rows.

---

## 5. Then — and only then

Phase C is **seven provider calls** — 3 STT, 3 TTS, 1 LLM — read by hand. That is where the twelve
undocumented questions get answered for a few rupees instead of a full sweep. Do not skip it,
and do not run the sweep until every adapter comes back clean.
