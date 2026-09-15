# Corpus Recording Specification

**For the first real benchmark run. Read this before recording anything.**

The corpus decides whether the benchmark result means anything. Every other part of the
harness has been written, reviewed and tested; none of it can compensate for a corpus that
does not represent the calls this product will actually make.

> **The single rule that cannot be broken:** every reference transcript and every entity
> expectation must be **written and frozen before any provider is contacted**. An
> expectation adjusted after seeing a provider's output is not a measurement, it is a
> preference. `corpusVersion` in the manifest is what makes that auditable — bump it if
> anything changes, and every run records which version it used.

---

## 1. Size and split

| | Utterances | Conversations | Why |
|---|---|---|---|
| Indian English (`en-IN`) | **20** | 4 × 5 turns | The default screening language |
| Hindi (`hi-IN`) | **15** | 3 × 5 turns | Real for a large share of candidates |
| **Hinglish / code-mixed** | **20** | 4 × 5 turns | The linguistic reality, and it carries its own sub-gate |
| **Total, quiet** | **55** | **11** | |
| **Noisy re-record** | **25** (a subset, same script) | 5 | Robustness condition, with margin |
| **Grand total to record** | **80** | **16** | |

**Why 25 noisy and not 20.** Twenty is *exactly* the verdict sample floor, so one hard
failure or one unscoreable sample drops the cohort to 19 and the whole noisy condition
reports INCOMPLETE. The fifth conversation is approved margin, labelled `MARGIN` in the
worksheet — delete rows from it if you want fewer than five spare takes. `bench scaffold`
emits all 16 conversations.

**Why 55 and not 30.** The decision rule needs **20 successful samples** before a
percentile is reported as a result, and the pre-registered protocol runs each stack **twice
at different times of day and pools** the turns. Fifty-five utterances pooled across two
runs gives n ≈ 110, which is the point at which p95 stops being "the second-largest of
thirty" and starts being a tail estimate.

**Why conversations and not lines.** The end-to-end runner carries conversation history: a
screening call is a conversation, and the LLM's fifth reply depends on the first four. Set
`conversationId` and `turnIndex` on every utterance. If you record 55 disconnected lines,
the harness will still run — and the report will warn you that it measured a cold first
turn 55 times, which is not what a five-minute screen does.

**Budget a full day.** Consent capture, retakes, two environments and writing per-utterance
entity expectations is not a two-hour job. The earlier estimate of "a couple of hours" was
optimistic and is withdrawn.

---

## 2. Recording settings — follow literally

| Setting | Value | Why it matters |
|---|---|---|
| Format | **16 kHz or higher, mono, 16-bit WAV** | Never record at 8 kHz. The narrowband condition is produced FROM the clean recording; if you record at 8 kHz the clean reference cannot be recovered and the `clean_16k` diagnostic is gone forever |
| Loudness | normalise every file to about **−23 LUFS** | Provider automatic gain control behaves differently at different input levels, for reasons that have nothing to do with recognition quality |
| Leading silence | **≤ 200 ms** | The post-endpoint residual is measured from the last audio frame. Leading silence inflates the wall-clock figure and makes the bias check harder to read |
| **Maximum length** | **≤ 30 seconds per utterance** | **Hard limit.** At least one candidate provider documents a 30-second cap on its real-time endpoint and routes anything longer to a batch API — a different product with different latency. An over-long utterance cannot be put to every candidate on equal terms. `bench validate` now **rejects** these |
| Target length | 5–15 seconds | Long enough to carry real content, short enough to leave headroom |
| Clipping | peak below full scale | A clipped recording degrades every provider unequally |
| Environments | record the script **twice**: a quiet room, and a genuinely noisy one | |

> **Noise mixed in afterwards is a simulation, not a condition.** If you add noise in
> post, label it as simulated. The same honesty line applies here as to carrier latency.

`bench validate --manifest <path>` checks every one of these, names the file, and costs
nothing. Run it before you think you are finished.

---

## 3. What the utterances must contain

These are the facts a screening call exists to collect. Each one is an **entity** in the
manifest, scored separately from word error rate, because getting the notice period wrong
silently rejects a qualified candidate while getting an article wrong costs nothing.

| Category | `kind` | Minimum instances | What to stress |
|---|---|---|---|
| **Names** | `name` | 10 | Indian given names and surnames across regions: Rajeshwari, Venkateshwaran, Priyadarshini, Krishnamurthy, Thiruvananthapuram-style length. Include at least 3 that a Western-trained model will not have seen |
| **Notice periods** | `duration` | 10 | **30 / 60 / 90 days**, "two months", "immediate", "serving notice". Include at least two **teens-vs-units** traps: "nineteen days" where "nine days" would also be plausible |
| **Numbers** | `number` | 10 | Years of experience, team sizes, counts. Spoken form AND numeral form |
| **Currency** | `money` | 10 | **lakh and crore**, both spoken ("twelve lakhs") and numeric ("12,00,000"), plus "LPA", "CTC", ranges ("18 to 22 lakhs") |
| **Dates** | `date` | 8 | "14th October", "next Tuesday", "the 3rd", "31st March 2027". Include one time-of-day ("3:30 in the afternoon") |
| **Phone numbers** | `phone` | 6 | 10-digit Indian mobiles, read in the three natural ways: as five-plus-five, as a continuous string, and digit by digit. Include one with a `+91` prefix |
| **Addresses / locations** | `location` | 8 | Bengaluru, Gurugram, Hyderabad, Thiruvananthapuram, Navi Mumbai; at least two multi-word ("Electronic City Phase 1") |
| **Relocation / negation** | `text` with `reject` | 6 | **"I cannot relocate", "I'd rather not move"** — an accept-list cannot express negation, so the inverting surface forms must be enumerated in `reject` or the entity dropped |

### Deliberately difficult cases — at least 12 utterances

These are the ones that decide the benchmark. A corpus of clean, cooperative speech will
rank every provider as good.

1. **Code-switching mid-sentence** — "Mera notice period 60 days ka hai, but I can negotiate."
2. **English technical terms inside a Hindi sentence** — Kubernetes, PostgreSQL, CI/CD.
3. **A long uninterrupted answer** (near the 30 s cap) with several facts in it.
4. **A mid-answer pause** of 1–2 seconds. Streaming providers emit a separate final per
   endpointed segment; this is the case that proves the harness accumulates them.
5. **Self-correction** — "My CTC is fifteen… sorry, eighteen lakhs."
6. **Fast speech**, and one noticeably **slow, hesitant** answer.
7. **Filler words** — "umm", "actually", "you know", "haan ji".
8. **A number read back digit by digit.**
9. **A very short answer** — "Yes." / "Haan."
10. **Regional accent variation** — record at least two speakers from different states.
11. **Background speech** in the noisy condition, not just noise.
12. **A word that sounds like another** — "nine"/"nineteen", "fifty"/"fifteen".

**Do not include profanity.** One candidate's service-default profanity setting has an
undocumented effect on the lexical transcript field this benchmark scores against, so a
profane utterance could be masked for one provider and not another.

---

## 3a. Devanagari alternates — required for every Hindi and Hinglish utterance

**This is not optional and it is not a style preference.** The three speech-to-text
candidates are each asked for their own *documented* configuration on code-mixed audio — one
gets an auto-detect sentinel, one a code-switching mode, one an Indian English locale — and
**those configurations return different alphabets.** A romanised reference scored against a
Devanagari transcription reports a **flawless** transcription as a **125% word error rate**.

So every `hi-IN` and `hinglish` utterance needs the same sentence written **twice**:

```json
{
  "reference":    "meri current ctc twelve lakhs hai",
  "referenceAlt": "मेरी करंट सीटीसी बारह लाख है"
}
```

The scorer picks whichever reference shares the transcript's alphabet. If neither does, the
sample is recorded **UNSCOREABLE** — excluded from accuracy, never counted against the
provider — and the Hinglish sub-gate cannot be applied to that provider at all.

`bench validate` **rejects** a `hi-IN` or `hinglish` utterance that supplies only one script.
That is 35 alternates for the quiet set. Writing them is transcription, not recording, so it
can happen after the session — but before any provider is contacted.

**Optional, in the same area:** `transliterationAliases` at the corpus level is a map applied
identically to reference and hypothesis, for variance you decide is not a recognition error
("naukri"/"naukari"). It may stay empty. Decide before the references are frozen.

## 4. Entity expectations — the part people get wrong

Every entity needs an `accept` list of the surface forms that count as captured. For numeric
kinds also give a `unit`, because that is what lets the scorer tell **wrong** from
**missing** — and a wrong notice period is the failure mode this metric exists to bound.

```json
{
  "name": "notice_period",
  "kind": "duration",
  "accept": ["90 days", "ninety days", "three months"],
  "unit": "days"
}
```

Rules learned from defects already caught in this harness:

- **Every accept form must actually appear in the reference.** `bench validate` rejects an
  expectation no perfect transcription could satisfy — otherwise it scores against every
  provider equally and silently drags the gate down.
- **Numbers are matched as whole token runs**, so `"19 years"` never satisfies `"9 years"`.
  You do not need to defend against that; you do need to write the unit.
- **Spoken and numeric forms are folded together** — `"twelve lakhs"`, `"12,00,000"` and
  `"1200000"` compare equal — so you do not need to enumerate both. You still may.
- **Negation needs `reject`.** `"relocate"` is contained in `"I cannot relocate"`.
- Set **`codeMixed: true`** only on utterances that genuinely code-switch. It selects the
  Hinglish sub-gate's sample, and marking easy monolingual utterances as code-mixed would
  make that gate trivially passable.

---

## 5. Consent — mandatory, and it decides which providers you may use

These are voice recordings of real people. Under the DPDP Act they are personal data, and
the manifest **will not load** without a consent record for every speaker.

The consent form **must name cross-border transfer explicitly**, and must name the
processors. Based on the 2026-08-24 documentation review, a run against all four candidates
sends candidate audio to:

| Provider | Where audio is processed | Status |
|---|---|---|
| ElevenLabs | United States | Documented — no India region offered |
| Deepgram | **Not India.** Only EU and AU regional endpoints are documented; the default global endpoint's processing location is **not documented** | Documented that India is unavailable |
| Cartesia | Default endpoint auto-routes to the nearest of an **unenumerated** pool. An India region exists but is **enterprise-only**, not reachable on a self-serve key | Not determinable from docs |
| Sarvam | **Not documented** for the model APIs used here. The India-residency claim in their documentation covers a different product | Must be asked directly |
| **Google (Gemini)** | **Not documented.** No India region exists for the Developer API, and the terms permit caching "in any country in which Google or its agents maintain facilities" | Documented that no residency control exists |

> **The LLM is a processor.** It receives the speech-to-text transcript — the words a
> candidate actually said — so it belongs on the consent form exactly as the speech vendors
> do. It is the one nobody thinks to disclose.
>
> ⚠️ **Do not use Google's unpaid tier.** Its terms state that unpaid input is used to improve
> Google products and that human reviewers may read it. That is incompatible with informed
> consent for recorded speech. Use a paid key.

> **A consent form saying only "for internal testing" makes the corpus legally unusable for
> at least two of the four candidates** — and re-consenting means re-contacting every
> participant. Name the processors, their countries (or "location not disclosed by the
> provider" where that is the truth), the retention period, and the deletion route.

The manifest requires `coversCrossBorderTransfer: true` and a non-empty
`disclosedProcessors` list. **Note the gap honestly:** the schema requires the list to
exist; it does not currently verify that the providers a run actually contacts are on it.
Checking that is on you until it is automated.

`speakerId` must be **pseudonymous** — the manifest is committed to git. Audio never is.

---

## 5a. Generate the shape before you record

```bash
pnpm bench scaffold --out corpus/pilot --speakers spk-mh-01,spk-ka-01 --corpus-version pilot-1
pnpm bench consent  --manifest corpus/pilot/manifest.json     # fill the consent block first
```

`scaffold` writes the manifest skeleton (all 80 slots, correct ids, conversation grouping,
turn order, file paths, and the consent block pre-filled with every processor a sweep will
contact), a `references.tsv` worksheet, and a printable `RECORDING_SHEET.md`.

**It writes no reference text and chooses no words.** Those are the ground truth the whole
benchmark rests on, and they are a human judgement.

`consent` works on the *unfilled* scaffold, which is exactly when it matters: it rejects
unreplaced placeholders, undisclosed processors, and disclosures that name a vendor without
saying where it processes. A missing processor found now costs a paragraph; found after the
session it costs re-contacting every participant.

Then record, fill the worksheet in any spreadsheet, and merge:

```bash
pnpm bench reference --manifest corpus/pilot/manifest.json --sheet corpus/pilot/references.tsv
pnpm bench validate  --manifest corpus/pilot/manifest.json
```

`reference` **skips** blank rows rather than stubbing them: a blank reference would be ground
truth nobody wrote, and every provider would be scored against it.

## 6. Directory layout

```
benchmark/corpus/<name>/
  manifest.json          committed
  audio/
    conv-01-t1.wav       NEVER committed (gitignored)
    conv-01-t2.wav
    ...
```

`corpus/example/` is a **template**. Its audio is synthetic tones, not speech; a run against
it cannot produce a provider decision. It exists so `validate` and `plan` can be exercised
before a recording session, and so real recordings drop into a known shape.

---

## 7. Before you call it done

```bash
pnpm bench validate --manifest corpus/<name>/manifest.json
```

Then check by hand, because the validator cannot:

- [ ] Every reference transcript is what was actually said, including fillers and
      self-corrections. This is a **verbatim** benchmark; every provider is asked for
      verbatim output, and a tidied-up reference penalises all of them equally but wrongly.
- [ ] Entity expectations reviewed once and **frozen**. Note the date.
- [ ] `conversationId` and `turnIndex` set on every utterance.
- [ ] `codeMixed` set only where the speech genuinely switches.
- [ ] Consent form signed, names the processors and countries, retention date recorded.
- [ ] `corpusVersion` set, and bumped if anything changed after the first validation.
- [ ] **`referenceAlt` written for every `hi-IN` and `hinglish` utterance.** `validate`
      enforces it, but check the Devanagari says the same thing as the romanised form —
      no validator can check that.
- [ ] `BENCHMARK_REGION=BLR1` set on the benchmark VM, not on a laptop.
