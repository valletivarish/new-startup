# Provider Adapter Verification Report

**Date of verification: 2026-08-24.** Every claim below was read from the provider's own
documentation on that date, then re-checked by a second reviewer whose only job was to
downgrade anything overclaimed.

> **No authenticated request has been made to any provider.** Nothing in this document
> should be read as "tested". The correct status for all four adapters is
> **DOCUMENTATION-VERIFIED, NEVER RUN**, and every adapter still carries `unverified: true`
> into run metadata and every report.

---

## 1. Method, and why it was worth doing

Four adapters were written from published documentation in Phase 5C and flagged unverified.
The obvious next step is to point them at real credentials and see what happens. That would
have been expensive in the wrong currency: a wrong request shape produces a 4xx, and a 4xx
in a benchmark is easy to read as "this provider is unreliable".

So each adapter was checked field by field against the provider's current official reference
first — every endpoint, header, body field, model id, language code and response path.
A second agent per provider then tried to **refute** each verification, on the principle
that a wrongly-confirmed field is worse than an unchecked one.

**Every one of the four adapters needed changes.** Two of them would have failed on the
first request; one would have measured the wrong thing successfully, which is worse.

| Provider | Verdict | Overclaim risk found by the refuter | Fields corrected |
|---|---|---|---|
| Sarvam | ADAPTER_NEEDS_CHANGES | MEDIUM | 4 |
| Deepgram | ADAPTER_NEEDS_CHANGES | MEDIUM | 2 |
| Azure | ADAPTER_NEEDS_CHANGES | MEDIUM | 4 |
| Cartesia | ADAPTER_NEEDS_CHANGES | **HIGH** | 5 |

---

## 2. The corrections that mattered most

### The one that would have measured the wrong thing successfully

**Sarvam's `mode` parameter defaults to `transcribe`, which applies normalisation.** The
adapter sent no `mode` at all — while declaring `textNormalisation: 'verbatim'` in its own
identity. It was asserting one thing and requesting another.

Word error rate is one of only two gates that can FAIL a run. Scoring normalised output
against verbatim references would have produced a WER penalty invented entirely by our own
request shape, and the run would have completed cleanly with no error to notice.

**Corrected:** `mode=verbatim` is now sent explicitly, and a test asserts it.

### The one that would have decided the Hinglish sub-gate

**Deepgram documents `language=multi` for code-switching.** The sweep sent `en-IN` for
code-mixed audio to every provider — a hard-coded mapping in the runner, applied to the
exact subset that carries its own 85% sub-gate and that is the strongest reason this
benchmark exists.

**Corrected structurally, not locally.** Language mapping is no longer the runner's business.
Each adapter now declares `languageFor(corpusLanguage)` from its own documentation, the
mapping is recorded in run metadata so the choice is auditable, and the sweep passes the
corpus's own label through untouched. Deepgram also gets `hi` rather than the undocumented
`hi-IN`.

**Cost consequence:** `multi` is billed at Deepgram's higher multilingual rate. The rate card
needs two Deepgram entries, not one.

### The one that would have aborted the sweep

**Cartesia's `/tts/bytes` declares only bearer authentication.** The adapter sent
`X-API-Key`, which is documented for the **WebSocket**. A rejected auth header is a 401,
which `classify()` correctly treats as a setup failure that **stops the whole sweep** — so
the run would have died looking like a bad key.

Also corrected: `Cartesia-Version` was `2024-06-10` against a current schema that pins the
header to `2026-08-14`; `model_id` was `sonic-2`, which is not in the current enum at all
and whose Hindi support was removed in June 2026; and `voice.mode` is absent from the current
schema.

### The one where the honest answer was "don't guess"

**Cartesia's documentation never pairs `pcm_s16le` with 8000 Hz.** It pairs it with 16000,
and reserves 8000 for the companded encodings. The first verification agent marked the
pairing VERIFIED on the grounds that the schema declares two independent enums with no
cross-constraint — which is deriving behaviour from the *absence* of a rule, exactly the
guessing this exercise exists to prevent. The refuter caught it.

This mattered more than it looks: `runTtsCase` computes duration as
`totalBytes / 2 / outputFormat.sampleRate`. If the service had coerced or resampled, **every
Cartesia duration and real-time-factor figure would have been wrong by a whole factor with no
symptom.**

**Corrected by requesting the documented pairing** — `pcm_s16le` at 16 kHz — and declaring
it. Which then created a fairness problem, addressed below.

---

## 3. Per-provider detail

### Sarvam AI

| Field | Was | Now | Status |
|---|---|---|---|
| STT endpoint, auth header, multipart field names | unchanged | unchanged | VERIFIED_OFFICIAL |
| STT model | `saaras:v2` | **`saaras:v3`** | MISMATCH → corrected. `saaras:v2` is in no current enum; v3 is the documented default and recommendation. `saaras:v4` exists and is newer |
| STT `mode` | not sent | **`verbatim`** | MISMATCH → corrected (see above) |
| STT language codes | `en-IN` / `hi-IN` | unchanged; code-mixed → `unknown` | VERIFIED_OFFICIAL for the two explicit codes. `unknown` is the documented auto-detect sentinel and is **our reading**, not a documented recommendation for code-mixing — recorded in metadata so it can be disagreed with |
| **STT max duration** | not enforced | corpus validator now **rejects** > 30 s | VERIFIED_OFFICIAL: 30 s per real-time REST request; longer goes to a batch API, which is a different product |
| TTS body | `inputs: [text]`, `target_language_code` | **`text`, `language_code`** | MISMATCH → corrected |
| TTS speaker | `meera` | **`anushka`** | MISMATCH → corrected; `meera` is in no documented enum for this model |
| TTS response sample rate | assumed 8 kHz | **validated, throws on mismatch** | NOT_DOCUMENTED that the response honours `speech_sample_rate` |
| TTS streaming | not used | not used | Documented, but only the TTS WebSocket was read end to end; the STT streaming protocol was not, so implementing either would mean guessing |
| **Data residency** | — | — | **NOT_DOCUMENTED** for the model APIs used here. The India-residency statement in their docs covers a different product |
| Cancellation stops billing? | — | — | **NOT_DOCUMENTED** for REST or WebSocket |

### Deepgram

| Field | Was | Now | Status |
|---|---|---|---|
| Endpoint, auth scheme (`Token`), raw-body upload, response path | unchanged | unchanged | VERIFIED_OFFICIAL — though the refuter notes the raw-binary body is documented in prose guides, not in the machine-readable schema |
| Hindi | `hi-IN` | **`hi`** | MISMATCH → corrected |
| **Code-mixed** | `en-IN` | **`multi`** | MISMATCH → corrected |
| `smart_format` / `punctuate` | not sent | not sent | VERIFIED_OFFICIAL that both default to false, so omitting them yields lexical output |
| Streaming | not used | not used | **PARTIAL_WOULD_REQUIRE_GUESSING** — the refuter found binary framing typed only as `string/format:binary`, which does not settle how audio frames are put on the wire |
| **Data residency** | — | — | **India is NOT available.** Only EU and AU regional endpoints are documented; the default global endpoint's processing location is **NOT_DOCUMENTED** |
| Pricing | — | — | The rates quoted by the first agent were flagged by the refuter as **promotional prices quoted as rates**. Treated as THIRD_PARTY in the rate card |

### Microsoft Azure AI Speech

| Field | Was | Now | Status |
|---|---|---|---|
| Region `centralindia`, STT/TTS availability there | — | — | VERIFIED_OFFICIAL |
| Endpoint host | regional host | regional host, **overridable** via `AZURE_SPEECH_ENDPOINT` | **Two forms appear in official docs** and it is not settled which a Central India key accepts. Exposed rather than guessed |
| Transcript field | `NBest[0].Lexical ?? DisplayText` | **`Lexical` only; throws otherwise** | MISMATCH → corrected. Display is the normalised form; the fallback would have scored Azure on different text than its peers |
| `RecognitionStatus` | only `NoMatch` handled | **`NoMatch`, `InitialSilenceTimeout`, `BabbleTimeout` → empty transcript; `Error` → provider failure** | MISMATCH → corrected. These are documented provider outcomes and will be common on degraded telephony audio |
| TTS `User-Agent` | not sent | **sent** | MISMATCH → corrected; documented as required |
| SSML `xmlns` | absent | **present** | MISMATCH → corrected; documented as required |
| TTS voice reported in metadata | English voice only | **both voices** | Found by the refuter: every report claimed the Hindi lines were synthesised by a voice that never touched them |
| 8 kHz output | assumed native | recorded as a **service-side downsample** | VERIFIED_OFFICIAL that voices synthesise at 24/48 kHz and other rates are derived |
| TTS response progressive? | assumed streaming | **`responseStreamingVerified: 'no'` in metadata** | **NOT_DOCUMENTED.** Time-to-first-byte for this adapter is provisional until measured |
| Free tier F0 | — | — | 5 audio hours/month STT, 0.5M chars/month TTS. **F0 real-time STT concurrency is 1 and not adjustable** |
| TTS auth header | `Ocp-Apim-Subscription-Key` | unchanged | **AMBIGUOUS** — the endpoint-scoped table marks `Authorization` required and omits the subscription-key header, while the service-wide table lists it. Unresolved; check on first contact |

### Cartesia

| Field | Was | Now | Status |
|---|---|---|---|
| Auth | `X-API-Key` | **`Authorization: Bearer`** | Refuter downgrade: X-API-Key is documented for the **WebSocket**, not this endpoint |
| `Cartesia-Version` | `2024-06-10` | **`2026-08-14`** | MISMATCH → corrected |
| `model_id` | `sonic-2` | **`sonic-3.5`** | MISMATCH → corrected; `sonic-2` is outside the current enum and lost Hindi in June 2026 |
| `voice` | `{ mode, id }` | **`{ id }`** | `mode` absent from the current schema |
| Output format | `pcm_s16le` @ 8000 | **`pcm_s16le` @ 16000** | **NOT_DOCUMENTED** pairing → replaced with the documented one |
| **Data residency** | claimed YES | **enterprise-only** | Refuter downgrade: India exists as a sales conversation, not as an endpoint a self-serve key can call. The default anycast pool is unenumerated |
| Streaming | HTTP chunked | HTTP chunked | Refuter downgrade to **PARTIAL** — the WebSocket AsyncAPI never states frame content type |
| **Price** | — | — | **No per-character or per-credit price is published anywhere.** Cartesia will be NOT PRICED in the cost estimate: rankable on latency and quality, not on cost |
| Credit-exhaustion HTTP status | — | — | **NOT_DOCUMENTED.** If it returns 429, the harness will retry into an empty balance. `--max-calls` bounds the damage |
| Voices for Indian English / Hindi | — | — | **No voice is documented as an Indian voice.** The accent catalog exposes `indian-english` and `hindi`; pick empirically via `GET /voices` |

---

## 4. A fairness problem the corrections created, and how it was handled

Requesting the documented Cartesia pairing means Cartesia now returns **16 kHz** audio while
the other TTS adapters return 8 kHz. Presented side by side in the blind listening gate, a
listener would prefer the 16 kHz sample — for a property of **our request**, not of the voice.

**Every sample is now resampled to the lowest rate present before anyone hears it.** That is
also the honest rate: a candidate on a PSTN call hears 8 kHz however good the synthesis was,
and evaluating TTS at a fidelity the product can never deliver would flatter the wrong thing.
The chosen rate is recorded in the blind-set mapping, and a regression test asserts every
written WAV carries it.

---

## 5. What is still UNVERIFIED, and cannot be resolved from documentation

These need a first authenticated request. They are listed here so the first contact is a
deliberate, scripted check rather than a full sweep that discovers them expensively.

| # | Question | Provider | Why it matters |
|---|---|---|---|
| 1 | Where is audio processed and stored? | **Sarvam** | Decides what the consent form must say. Not documented for the model APIs |
| 2 | Where does the default endpoint process audio? | **Deepgram** | Same. India is documented as unavailable |
| 3 | Which endpoint host does a Central India key accept? | **Azure** | Both forms are documented |
| 4 | Does the REST TTS body arrive progressively? | **Azure** | If TTFB scales with text length, the body is buffered and the figure is not comparable |
| 5 | Does aborting stop billing? | **all four** | An explicit pre-flight requirement of the benchmark design. Undocumented everywhere |
| 6 | What status does credit exhaustion return? | **Cartesia** | If 429, the harness retries into an empty balance |
| 7 | Is `pcm_s16le` @ 16 kHz actually returned at 16 kHz? | **Cartesia** | Confirm the byte rate before trusting any duration figure |
| 8 | Are the named voices served from Central India? | **Azure** | Checkable free via `voices/list` |
| 9 | Does `mode=verbatim` produce the text form our references are written in? | **Sarvam** | Its documented example renders digits as spoken words |
| 10 | Does the response honour `speech_sample_rate`? | **Sarvam** | Now fails loudly rather than silently mis-measuring |
| 11 | Is `CARTESIA_VOICE_ID` compatible with `sonic-3.5`? | **Cartesia** | `voice_model_mismatch` is a documented error |
| 12 | Central India S0 rates | **Azure** | The pricing page renders rate cells as placeholders to a fetcher |

**The recommended first contact is one utterance and one line per provider**, checked by
hand — not a sweep. See `FIRST_BENCHMARK_RUN_PLAN.md` §2.

---

## 6. Status

| Adapter | IMPLEMENTED | TESTED (fakes + request-shape) | VERIFIED AGAINST REAL PROVIDER | Blocking issues |
|---|---|---|---|---|
| `sarvam` STT | ✅ | ✅ | ❌ **never run** | residency undocumented |
| `sarvam` TTS | ✅ | ✅ | ❌ **never run** | residency undocumented |
| `deepgram` STT | ✅ | ✅ | ❌ **never run** | no India region |
| `azure` STT | ✅ | ✅ | ❌ **never run** | endpoint host ambiguous |
| `azure` TTS | ✅ | ✅ | ❌ **never run** | streaming unverified |
| `cartesia` TTS | ✅ | ✅ | ❌ **never run** | no published price |
| **LLM (any)** | ❌ **not written** | — | — | **no model confirmed by the founder** |

20 adapter conformance tests assert the corrected request shapes against a stubbed fetch.
They contact nothing, and every test credential in them is a literal string reading
`test-key-not-real`.
