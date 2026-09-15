# Provider Credential and Setup Checklist

**Everything the founder must do before the first real benchmark run.**

I will not create provider accounts or handle API credentials. This document tells you
exactly which keys are needed, where they go, and what to check on each provider's own
console — plus the questions that only a first authenticated request can answer, because the
documentation does not settle them.

> Every fact below was read from the provider's own documentation on **2026-08-24**, and
> re-checked by a second reviewer whose job was to downgrade anything overclaimed. Where the
> two disagreed, the more conservative answer is recorded. **Nothing here has been tested
> against a live service.**

---

## 1. Environment variables

**Edit only the repository root `.env`.** That is the single source of truth.

`benchmark/.env.benchmark` is a local symlink to `../.env` so older docs/commands
that source it still work — you never copy-paste twice. The CLI loads root `.env`
at startup (shell env still wins). Blank values are treated as unset.

```bash
pnpm bench doctor
```

`.env` and `.env.*` are gitignored (with `!.env.example` as the only exception). Never paste
a key into a file that is committed.

**The keys belong on the benchmark VM, not on the laptop.** A spending run requires
`BENCHMARK_REGION=BLR1` and must execute where production will run, so the laptop only ever
needs them for free `doctor` checks. Rotate or revoke every key once the sweep is finished —
they are benchmark-scoped and have no reason to outlive it.

| Adapter | Required | Optional |
|---|---|---|
| `sarvam` | `SARVAM_API_KEY` | `SARVAM_STT_MODEL`, `SARVAM_TTS_MODEL`, `SARVAM_TTS_SPEAKER` |
| `deepgram` | `DEEPGRAM_API_KEY` | `DEEPGRAM_MODEL` |
| `elevenlabs` | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | `ELEVENLABS_STT_MODEL`, `ELEVENLABS_TTS_MODEL` |
| `cartesia` | `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID` | `CARTESIA_MODEL`, `CARTESIA_VERSION` |
| `gemini` | `GEMINI_API_KEY` | `GEMINI_MODEL` |
| *(benchmark host)* | **`BENCHMARK_REGION=BLR1`** | — |

Check them without spending anything:

```bash
pnpm --filter @platform/benchmark bench doctor
```

It prints variable **names** and a present/missing flag, never a value. A test asserts that
every variable any adapter reads appears in the registry's required or optional list, so
this table cannot silently drift from the code.

---

## 2. Sarvam AI

**Sign up:** sarvam.ai · **Free allowance:** ₹100 of credits on signup, documented as never
expiring.

**Rates (OFFICIAL, read 2026-08-18):** STT ₹30/hour billed per second · TTS Bulbul v2
₹15 per 10K characters. Plan rate limits: Starter 60 req/min.

**What the adapter now sends, after the documentation check corrected it:**

| | Value | Note |
|---|---|---|
| STT model | `saaras:v3` | Was `saaras:v2`, which is in no current enum. `saaras:v4` exists and is newer, but v3 is the documented default and recommendation |
| STT mode | `verbatim` | **Was not sent at all.** The default is `transcribe`, which normalises — the adapter was declaring verbatim and requesting normalised |
| TTS body | `text` (string), `language_code` | Was `inputs` (array) and `target_language_code`, neither of which appears in the current reference |
| TTS speaker | `anushka` | Was `meera`, which is in no documented enum for this model |

**On your console, before running:**
- [ ] Confirm the ₹100 credit is present and note the balance, so you can measure what the
      sweep actually consumed.
- [ ] Confirm which models your key can call. If `saaras:v3` is not available to you,
      set `SARVAM_STT_MODEL` rather than editing code.

**Ask Sarvam directly — the documentation does not answer these:**
- [ ] **Where is audio submitted to `/speech-to-text` and `/text-to-speech` processed and
      stored?** The India-residency statement in their docs covers a different product. This
      determines what your consent form must say.
- [ ] **Does aborting an in-flight synthesis stop billing?** Not documented for REST or
      WebSocket. The benchmark design requires this be settled before recording begins.
- [ ] What is the byte-size limit on the STT multipart upload? Only the 30-second duration
      cap is documented.

---

## 3. Deepgram

**Sign up:** deepgram.com · **Free allowance:** $200 credit on signup.

**What the adapter now sends:**

| | Value | Note |
|---|---|---|
| Hindi | `language=hi` | Was `hi-IN`, which is not documented |
| **Code-mixed** | **`language=multi`** | **Was `en-IN`.** This is the most consequential correction of the round — `multi` is the documented configuration for code-switching, and the Hinglish subset carries its own sub-gate |
| Formatting | none sent | `smart_format` is deliberately off so the output is lexical, matching the other two adapters |

**Cost warning:** `language=multi` is billed at Deepgram's **multilingual** rate, which is
higher than the monolingual rate. Roughly 20 of 55 corpus utterances are code-mixed, so the
Deepgram line in any cost estimate needs **two** rate-card entries, not one.

**On your console, before running:**
- [ ] Note the starting credit balance.
- [ ] Confirm `nova-3` is available to your key.

**Ask Deepgram directly:**
- [ ] **Where does the default `api.deepgram.com` endpoint process audio?** Only EU and AU
      regional endpoints are documented; **no India region exists**. The default endpoint's
      location is not documented, and your consent form needs it.
- [ ] Whether they will contract for DPDP-relevant cross-border transfer terms.

---

## 4. ElevenLabs — replaced Azure on 2026-08-25

**Why Azure was dropped, since it was not a quality judgement.** An Azure
subscription is *disabled* 30 days after signup unless it is upgraded to
pay-as-you-go, and the $200 trial credit expires unused at the same moment. The
benchmark needs 7.7 minutes of audio, which sits inside the always-free F0 tier
and touches none of that credit — so signing up would have spent a ~₹17,000
window, roughly two months of the project budget, to buy nothing. ElevenLabs
fills both of Azure's roles from one key with no expiring subscription.

**What the swap costs, stated plainly.** Azure was the second India-region
candidate. Sarvam is now the only one, so the data-residency question rests
entirely on it. ElevenLabs is US-hosted and adds real network latency from BLR1
— which the benchmark measures rather than assumes. `createAzureStt` and
`createAzureTts` are kept in `RETIRED_ADAPTERS` and still tested; restoring them
is a move between two objects.

- [ ] Sign up at <https://elevenlabs.io> and create a key under
      **Settings → API Keys**. The free tier is 10,000 TTS characters per month
      — the benchmark needs about 4,600 across all passes.
- [ ] Pick a voice in the Voice Library and copy its **uuid**, not its display
      name, into `ELEVENLABS_VOICE_ID`. Required, not optional: voice choice
      moves the blind listening gate more than most provider differences, so it
      must be a decision the pre-flight can show.
- [ ] One multilingual voice covers both Hindi and English. Unlike Azure,
      ElevenLabs documents no per-language voice catalogue, so a second Hindi
      voice is not configured. Whether one voice is as good in Hindi as a
      Hindi-specific voice would be is exactly what the listening gate decides.

**Verified against the official reference on 2026-08-25:** auth is the
`xi-api-key` header (not Bearer); STT is `POST /v1/speech-to-text` as
`multipart/form-data` with the audio under `file` and a required `model_id`;
`scribe_v1` is **deprecated** in favour of `scribe_v2`; `language_code` is
ISO-639-1 (`hi`, not `hi-IN`); TTS streams **raw audio bytes** from
`/v1/text-to-speech/{voice_id}/stream`, not SSE, with `output_format=pcm_8000`
as a query parameter.

**UNVERIFIED and load-bearing:** whether Scribe's default output is the verbatim
form the reference transcripts are written in. The reference documents a
`no_verbatim` boolean without defining what it toggles. The adapter sends
`no_verbatim=false` rather than trusting a default. **Stage 1 must read the
returned text and confirm it is unpunctuated and un-normalised before any WER
from this adapter is compared with Sarvam's or Deepgram's.** This is the same
trap Azure's `Display`/`Lexical` split set, and the docs do not settle it.

---

## 5. Cartesia

**Free plan:** 20K credits/month · **TTS concurrency limit 2**. Metering is ~1 credit per
character, and **only successful requests consume credits**.

**`CARTESIA_VOICE_ID` is required, not optional.** Voice choice materially changes the blind
listening gate, so it must be a deliberate decision. The pre-flight check will refuse to run
without it — a change made because an earlier version reported Cartesia as ready, started
the sweep, and produced ten hard failures for a provider that was never contacted.

**What the adapter now sends, after five corrections:**

| | Value | Note |
|---|---|---|
| Auth | `Authorization: Bearer <key>` | Was `X-API-Key`, which is documented for the **WebSocket**; the `/tts/bytes` spec declares only bearer schemes. A rejected header is a 401, which **stops the whole sweep** and looks like a bad key |
| `Cartesia-Version` | `2026-08-14` | Was `2024-06-10`. The current schema pins the header to one value, and an old version also returns plain-text errors with no error code |
| `model_id` | `sonic-3.5` | Was `sonic-2`, which is not in the current enum and whose Hindi support was removed in June 2026 |
| `voice` | `{ id }` | `mode` is absent from the current schema |
| Output | `pcm_s16le` @ **16000** | The docs pair `pcm_s16le` with 16 kHz and reserve 8 kHz for companded encodings. **8 kHz with this encoding is not a documented pairing**, so it is not requested. The blind listening pack levels every provider to one rate before anyone hears it |

**Before running:**
- [ ] `GET /voices?language=hi` and `GET /accents` to pick a voice **empirically**. No voice
      in the docs is labelled as an Indian English or Hindi voice, though the accent catalog
      exposes `indian-english` and `hindi`. Do not paste a voice id from a playground click
      without checking it is compatible with `sonic-3.5`.
- [ ] Note the starting credit balance.

**Open, undocumented — and one of them is a money risk:**
- [ ] **What HTTP status does credit exhaustion return?** No page maps error codes to
      statuses. The harness treats `402` as a quota wall that stops the sweep, and `429` as
      transient and retryable. **If Cartesia returns 429 for exhausted credits, the harness
      will retry into an empty balance.** `--max-calls` bounds the damage; settle the
      question before a long run.
- [ ] Does aborting after the first byte still consume credits for the whole transcript?
- [ ] **No per-character or per-credit price is published anywhere.** Cartesia will come out
      **NOT PRICED** in the cost estimate — it can be ranked on latency and quality, but not
      on cost, until you get a rate in writing.

---

## 5a. Google Gemini — the LLM held constant

**Model: `gemini-3.5-flash-lite`.** Benchmark constant (updated 2026-09-15 after
`gemini-2.5-flash-lite` stopped accepting new API keys). It is not a production selection.

**Verified against Google's documentation on 2026-08-24**, and that check found three things
worth acting on before you create a key:

> ### ⚠️ 1. Create an **Auth key**, not a Standard key
>
> Google has split API keys into Standard (project-scoped) and Auth (bound to a Cloud service
> account), and the documentation states: **"On September 2026: the Gemini API will reject
> requests from Standard keys."** That is days away. New keys created in AI Studio are
> already Auth keys — but if you are holding an older key, it stops working.
>
> ### ⚠️ 2. Use a **paid** key. Do not benchmark on the free tier.
>
> Google's terms distinguish the tiers sharply:
>
> | | Unpaid | Paid |
> |---|---|---|
> | Used to improve Google products | **Yes** | No |
> | Retention | 1 day | 55 days (configurable) |
>
> and, verbatim: *"human reviewers may read, annotate, and process your API input and
> output."* You will be sending transcripts of real people's recorded speech. **Free-tier
> terms are incompatible with informed consent for that**, and the entire benchmark's LLM
> bill is about **₹0.42**, so there is nothing to save.
>
> ### ⚠️ 3. There is no India region, and no residency control
>
> Data residency exists on Vertex AI, **not** on the Developer API this adapter uses. Google's
> terms permit caching *"in any country in which Google or its agents maintain facilities."*
> The consent form must say exactly that rather than implying a location.

**What the adapter sends**, after the documentation check corrected four assumptions:

| | Value | Note |
|---|---|---|
| Endpoint | `POST .../v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse` | confirmed |
| Auth | header `x-goog-api-key` | not `?key=`, which puts a secret in URLs and logs |
| Roles | `user` / `model` | **`assistant` appears nowhere in Google's docs** — it is an OpenAI convention |
| System prompt | `system_instruction` as a Content object with `parts` | not a bare string |
| Text path | `candidates[0].content.parts[0].text` | confirmed |

**Also handled, because the docs are explicit about it:** a response can contain **zero
candidates** when `promptFeedback.blockReason` is set. With real speech transcripts that will
fire eventually, and indexing `candidates[0]` blindly would read a blocked prompt as silence.

**A quota hazard, now handled:** Google returns **HTTP 429 for both** a transient per-minute
rate limit **and** a hard daily-quota exhaustion, and publishes no 402 at all. The status code
alone cannot tell them apart, so the harness reads the body's error code: `quota_exceeded`
stops the sweep, `rate_limit_exceeded` retries. Without that it would retry into an exhausted
quota — the exact failure the retry policy exists to prevent.

**Still open:** Google no longer publishes per-model rate limits ("viewable in Google AI
Studio"), so the requests-per-minute ceiling cannot be read from documentation. Check it in
AI Studio before a long run.

> **Note the API surface.** `generateContent` is now labelled **Legacy**; Google recommends a
> newer Interactions API for new development while stating this one *"remains fully
> supported"* with **no shutdown date**. It is used deliberately: its streaming shape is
> documented well enough to implement without guessing, and the benchmark needs one plain
> sentence, not the newer API's feature set.

---

## 6. Local environment

```bash
pnpm --filter @platform/benchmark bench doctor
```

- [ ] **ffmpeg with a narrowband encoder.** The deciding condition is a real narrowband
      codec round trip. This machine's ffmpeg 8.1 can encode **G.726 only** — a real ITU-T
      narrowband codec, but **not** the AMR-NB an Indian mobile actually applies on the radio
      leg. `doctor` says so, and every report prints the substitution. Installing an ffmpeg
      built with `libopencore-amrnb` gets you the closer approximation. **The condition
      refuses to run at all if no narrowband encoder exists**, rather than silently degrading
      to a downsample.
- [ ] **`BENCHMARK_REGION=BLR1` on the benchmark VM.** Resolved 2026-08-24: **Bangalore
      (DigitalOcean BLR1)**, because the benchmark must run where production will run — BLR1
      is the primary infrastructure choice and the only provider combining a real Indian
      region with managed Postgres in that region.

      A spending run **refuses to start** without it, checked free before `--confirm`. The
      value is recorded in run metadata and printed in every report as **declared, not
      verified** — nothing inside the process can prove where a machine is, and claiming
      otherwise would be the kind of overstatement this project keeps catching.

      **Do not set it on a laptop to silence the message.** That produces a number that looks
      like a measurement and is not one.
- [ ] Budget ~₹300–500 for the VM.

---

## 7. The LLM — decided

`gemini-3.5-flash-lite`. See §5a. The end-to-end run — the only one that
measures the 1200 ms gate — can now execute once credentials and a corpus exist.

---

## 8. Rate card

Cost estimation reads a JSON rate card. `benchmark/rates.example.json` ships with the two
rates this project has read on an official page, and deliberately omits the rest:

```bash
pnpm bench plan --manifest corpus/<name>/manifest.json --rates rates.example.json
```

It prints `NOT PRICED` for anything without a rate, labels the total a **floor**, and warns
on every non-official figure. Fill in the missing entries from each provider's own pricing
page, with the URL and the date you read it — and remember the Deepgram multilingual rate.

**A rate that has not been verified is not a rate.** A search summary once reported Sarvam's
pricing wrong on three of three figures; that is why every entry carries its provenance.
