# Recording Session — Operator Guide

**Nothing in this guide contacts a provider or spends a rupee.** Every command below is
free and offline. The first paid call happens in Stage 1, after you bring the corpus back.

**Ground truth is yours.** This guide tells you the shape of each recording and which kind
of fact it must carry. It does not tell you what to say, and no sentence, name, figure or
Devanagari line in this corpus may be written by me. The `reference` field must be what was
actually spoken.

---

# A. Before recording

### Speakers

- **At least two**, from **different states**. `bench scaffold` refuses a single-speaker
  corpus: one voice measures how well a provider handles that person.
- Give each a **pseudonymous id** — `spk-mh-01`, `spk-ka-01`. **Never a real name.** The
  manifest is committed to git; the audio never is.
- The scaffold alternates speakers across conversations. If a different pairing suits your
  volunteers, edit the `speakerId` column — it is just a label.

### Consent — must pass before a microphone is switched on

Every speaker's consent must name **all five processors**, each entry beginning with the
adapter id, followed by prose for the person signing:

```
sarvam   — Sarvam AI. Processing location NOT documented by the provider.
deepgram — Deepgram, United States. No India region is available.
elevenlabs — ElevenLabs, United States. No India region is offered.
cartesia — Cartesia. Endpoint region not disclosed; India is enterprise-only.
gemini   — Google LLC (Gemini Developer API). Location NOT documented; may be processed in
           any country where Google maintains facilities. Receives the transcript of your speech.
```

> **Say "not documented" where it is not documented.** No candidate now states an
> Indian processing region: Azure, which did, was dropped on 2026-08-25 for a
> reason unrelated to quality (see BENCHMARK_GATE_DECISIONS.md § E).
> Do not describe Sarvam, Cartesia or Gemini as processing in India — the benchmark records
> their residency as UNVERIFIED and the consent form must match.
>
> **Gemini is on the list because it receives the transcript of what was said.** It is a
> processor of personal data exactly as the speech vendors are.

Also fill in, replacing every placeholder: `obtainedAt`, `retentionUntil` (a real deletion
date), `deletionContact` (an address a participant can actually write to). Cross-border
transfer is covered by `coversCrossBorderTransfer: true`, which the schema already forces.

```bash
pnpm bench consent --manifest corpus/pilot/manifest.json     # must exit 0
```

Verified behaviour: on the unfilled scaffold this reports every placeholder date, contact and
processor description and **exits 1**.

### Environment and device

| | Requirement |
|---|---|
| Quiet set | A quiet room. No music, no fan directly on the mic |
| Noisy set | A **genuinely noisy** place — street, café, a room with a TV on |
| Format | **16 kHz or higher, mono, 16-bit WAV** |
| Level | Normalise to about **−23 LUFS**; peak below full scale |
| Lead-in | Trim leading silence to **≤ 200 ms** |

**Never record at 8 kHz.** The deciding narrowband condition is produced *from* the clean
recording; an 8 kHz source cannot be un-narrowed and the clean reference is gone forever.

**Noise added afterwards is a simulation, not a condition.** If you mix noise in post, say so
— it must be labelled as simulated, and it is not the noisy condition this benchmark means.

### Region

```bash
export BENCHMARK_REGION=BLR1     # on the Bangalore VM. Not on a laptop.
```

Not needed to record. Needed before any run, and a spending run refuses to start without it.

### What must NOT be recorded

- **No profanity.** One provider's default setting has an undocumented effect on the exact
  transcript field this benchmark scores against, so a profane utterance could be masked for
  one provider and not another.
- **No real candidate data, real employer names, or anyone's actual phone number.** Phone
  numbers must be invented digit strings that are not in service.
- **Nobody who has not signed.** Including a voice in the background that belongs to a person
  who did not consent.

---

# B. During recording

### Conversation structure

**16 conversations of 5 turns = 80 recordings.**

| Set | Conversations | Utterances | Language |
|---|---|---|---|
| `conv-01` … `conv-04` | 4 | 20 | Indian English (`en-IN`) |
| `conv-05` … `conv-07` | 3 | 15 | Hindi (`hi-IN`) |
| `conv-08` … `conv-11` | 4 | 20 | **Hinglish / code-mixed** |
| `noisy-01` … `noisy-05` | 5 | 25 | Re-records — see below |

Each conversation is **one continuous screening exchange**, not five disconnected lines. The
speaker is the *candidate*; the interviewer's questions are not recorded. Record turn 1, then
turn 2 as an answer to a plausible next question, and so on — the end-to-end run replays the
five turns with history, so turn 5 should sound like it follows turn 4.

**Target 5–15 seconds per utterance. The hard ceiling is 30 seconds** — one provider's
real-time endpoint caps there, and `bench validate` rejects anything longer.

### Which fact each turn carries

The worksheet's `notes` column names it, for example `include: name, duration`. That
allocation sums to exactly the specification's 68 minimums, so following it means the corpus
cannot come up short. **The categories are given; the sentence is yours.** Make it a natural
answer a real candidate would give.

### The behaviours to spread across the sessions — at least 12

These are *how* things are said, not *what*, so they are not tied to slots. Cover them all:

| Behaviour | Where it fits naturally |
|---|---|
| Mid-sentence code-switching | any `conv-08`…`conv-11` turn |
| English technical terms inside Hindi | `conv-05`…`conv-07` |
| A long answer near the 30 s cap | one turn, once |
| **A 1–2 second pause mid-answer** | one turn — keep recording through it |
| **A self-correction** ("fifteen… sorry, eighteen lakhs") | one turn |
| A noticeably fast answer | one turn |
| A hesitant answer | one turn |
| Filler words ("umm", "actually", "haan ji") | several turns |
| **A phone number read digit by digit** | a `phone` slot |
| A very short answer ("Haan.") | one turn |
| Two regional accents | your two speakers |
| Background speech (not just noise) | the noisy set |
| **A nine/nineteen or fifty/fifteen confusable** | a `number` or `duration` slot |

### How to handle what happens

- **Pauses** — keep recording. Do not cut them. A mid-answer pause is one of the required
  cases: it is what makes a streaming provider emit two finals instead of one.
- **Self-corrections** — keep both halves. Record "fifteen… sorry, eighteen lakhs" exactly.
  Then write the reference the same way, and put **the corrected value** in the entity's
  `accept` list, because that is what a screening call would need to capture.
- **Fillers** — keep them. Every provider is asked for verbatim output, so a tidied reference
  penalises all of them equally and wrongly.
- **Code-switching** — switch where it is natural. Do not force a language boundary at a
  sentence break; mid-sentence is the case that matters.
- **Retakes** — if a take is spoiled, record it again over the same filename. Only the take
  you keep should exist. Do not keep alternates in `audio/` — every WAV present is treated as
  corpus.
- **A slot you cannot fill** — leave the worksheet row blank. `bench reference` skips blank
  rows rather than stubbing them, and `bench validate` will tell you the cohort is short.
  Do not invent a sentence to fill a gap.

### The noisy re-records

`noisy-01` … `noisy-05` are **re-recordings of named quiet conversations, using the same
words.** The worksheet says which, per turn:

```
noisy-01-t1   RE-RECORD of conv-01-t1 in a noisy room — same words, copy its reference and entities across
```

| Noisy | Re-records | Language |
|---|---|---|
| `noisy-01` | `conv-01` | en-IN |
| `noisy-02` | `conv-05` | hi-IN |
| `noisy-03` | `conv-08` | hinglish |
| `noisy-04` | `conv-09` | hinglish |
| `noisy-05` | `conv-02` | en-IN — **MARGIN**, spare takes |

Same words, different room. That is the entire point: the only variable between the quiet and
noisy conditions must be the noise. **Copy the `reference`, `referenceAlt` and `entities`
across unchanged** — if the speaker says something different, it is a different utterance and
the comparison is measuring the script rather than the noise.

`noisy-05` is approved margin: 20 noisy utterances is *exactly* the verdict sample floor, so
one failure would make the whole noisy condition INCOMPLETE. Record it if you can; delete
those rows if you would rather not.

---

# C. After recording

### Filenames and placement

The worksheet's `file` column is authoritative. Name every file exactly as it says:

```
benchmark/corpus/pilot/
  manifest.json          ← consent filled in                    COMMITTED
  references.tsv         ← one row per recording, filled in      COMMITTED
  audio/
    conv-01-t1.wav  …  conv-11-t5.wav       55 quiet             NEVER COMMITTED
    noisy-01-t1.wav …  noisy-05-t5.wav      25 noisy             NEVER COMMITTED
```

80 files. `benchmark/corpus/**/*.wav` is already gitignored.

### Filling `references.tsv`

Open it in any spreadsheet — it is tab-separated. Fill four columns; leave the rest alone.

**`reference`** — verbatim. What was **actually said**, including fillers, hesitations and
self-corrections. Not a tidy version. Not corrected grammar. If the speaker said
"umm, mera notice period… ninety days hai", that is the reference.

**`referenceAlt`** — **required for every `hi-IN` and `hinglish` row.** The *same* utterance
in the other alphabet: romanised in one field, Devanagari in the other. Same words, same
meaning, same fillers — a transliteration, not a translation and not a cleanup.

> Why it is mandatory: the three speech-to-text candidates are each asked for their own
> documented configuration on code-mixed audio, and those configurations **return different
> alphabets**. A romanised reference scored against a Devanagari transcription reports a
> flawless transcription as a **125% word error rate**. Validation rejects a `hi-IN` or
> `hinglish` row without a genuine second-script reference — verified.

**`entities`** — semicolons between entities, pipes between fields:

```
name|kind|accept1/accept2|unit|reject1/reject2
```

```
notice_period|duration|ninety days/90 days|days
current_ctc|money|twelve lakhs/12 lakhs|lakhs
relocate|text|can relocate/willing to relocate||cannot relocate/not able to relocate
skills|text|CI\/CD/continuous integration
```

- `unit` and `reject` are optional — keep the empty bars.
- **A delimiter inside a value needs a backslash**: write `CI\/CD`. Verified: it round-trips
  correctly, and unescaped it becomes two separate accept forms — an expectation no provider
  can satisfy, scored against all of them, invisible in the output.
- Every `accept` form must actually appear in the reference, or validation rejects it.
- `reject` is how negation is expressed: an accept-list cannot, because "I cannot relocate"
  contains "relocate".
- Give numeric kinds a `unit` — it is what lets the scorer tell a **wrong** value from a
  **missing** one, and a wrong notice period silently rejects a qualified candidate.

**`codeMixed`** — `yes` only where the speech **genuinely switches language**. It selects the
sample for the 85% Hinglish sub-gate; marking easy monolingual rows would make that gate
trivially passable. The scaffold presets it for the `hinglish` conversations — correct it if
a given turn did not actually switch.

### Validate

```bash
cd benchmark

pnpm bench consent   --manifest corpus/pilot/manifest.json
pnpm bench reference --manifest corpus/pilot/manifest.json --sheet corpus/pilot/references.tsv
pnpm bench validate  --manifest corpus/pilot/manifest.json
pnpm bench plan      --manifest corpus/pilot/manifest.json --rates rates.json
```

`reference` validates **before** it writes: a malformed entity or a missing Devanagari
alternate leaves the manifest untouched and exits 1 — verified.

**Proceed only when `validate` reports `0 errors`.** Warnings are worth reading. Errors are
blocking, and `bench run` refuses an invalid corpus.

### Freeze, before Stage 1

There is **no `bench freeze` command** — I verified this rather than assuming it. Use the
tools already present:

```bash
cd benchmark/corpus/pilot
{ echo "corpusVersion: $(python3 -c "import json;print(json.load(open('manifest.json'))['corpusVersion'])")"
  echo "frozenAt:      $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "gitCommit:     $(git -C ../../.. rev-parse HEAD)"
  echo "---"
  find . -name '*.wav' -o -name 'manifest.json' -o -name 'references.tsv' | sort | xargs shasum -a 256
} > FROZEN.txt

# later, to prove nothing moved:
shasum -a 256 -c <(grep -E '^[0-9a-f]{64}' FROZEN.txt)
```

Verified: this detects a changed audio file. Commit `FROZEN.txt`, `manifest.json` and
`references.tsv` together, and **do not touch the corpus after Stage 1 begins.** If a
recording turns out to be genuinely unusable, stop, replace it deliberately, bump
`corpusVersion`, re-freeze, and say so — do not swap a file quietly.

*(Run metadata already records a checksum of every conditioned utterance, and pooling refuses
to combine runs whose checksums differ — so drift between runs is caught automatically. What
the manual freeze adds is a record from before the first run.)*

---

## What to bring back

1. `benchmark/corpus/pilot/manifest.json` — consent complete, no placeholders
2. `benchmark/corpus/pilot/references.tsv` — 80 rows filled
3. `benchmark/corpus/pilot/audio/` — 80 WAV files
4. `benchmark/corpus/pilot/FROZEN.txt`
5. The five API keys, and confirmation that `BENCHMARK_REGION=BLR1` is set on the BLR1 VM
6. For Gemini: confirmation it is an **Auth key** on the **paid** tier

Then I run **Stage 1 only** — one representative utterance, **seven live calls** (3 STT,
3 TTS, 1 LLM), each result inspected by hand. Not the sweep.

---

## Confirmed for this phase

**No provider was contacted. No credit was consumed. No provider integration was created. No
SDK was added. No pre-registered rule, threshold or gate was changed.** The only commands run
were `scaffold`, `consent`, `reference`, `validate`, `plan`, `doctor` and the test suite —
all of which are offline by construction, and `plan` prints "No provider was contacted.
Nothing was spent."
