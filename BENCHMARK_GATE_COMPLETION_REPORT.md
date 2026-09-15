# Benchmark Gate — Implementation Completion Report

**Date: 2026-08-24.** All six approved decisions implemented and tested.

> **Still true after this phase:** no production speech provider selected · no telephony
> provider selected · no provider SDK installed anywhere · no production agent architecture,
> billing or pricing modified · **no provider contacted and no credit spent**.
>
> Enforced mechanically: `apps/api/test/production-boundary.test.ts` fails the build if a
> provider name reaches production code or any provider SDK is declared.

---

## 1. What was decided, and what it changed

| # | Decision | Implemented as |
|---|---|---|
| 1 | Benchmark LLM: **`gemini-2.5-flash-lite`** | `benchmark/src/adapters/gemini/index.ts`, registered as the single entry in `LLM_ADAPTERS`. Fetch only, no SDK |
| 2 | Location: **Bangalore / BLR1** | `benchmark/src/config/region.ts`; design document amended |
| 3 | **`BENCHMARK_REGION` mandatory** | Free pre-flight refuses `--confirm` without it; recorded in metadata; pooling refuses to mix regions |
| 4 | **`referenceAlt`** | Validator now *rejects* a Hindi or Hinglish utterance without a genuine second-alphabet reference |
| 5 | **Spare noisy takes** | Scaffold emits 5 noisy conversations (25 utterances) — 20 required plus a labelled `MARGIN` conversation |
| 6 | **Recording scaffold + reference helper** | `bench scaffold`, `bench reference`, `bench consent` |

**Your residency qualification was implemented exactly as stated.** Gemini's identity records
`dataResidency: "NOT DOCUMENTED — no India region; may be processed in any country"`, carries
`unverified: true` like every speech adapter, and appears in the consent disclosure. No
India-only claim is made anywhere.

---

## 2. Verification before writing the adapter

I did not write the Gemini client from memory. It was verified field by field against
Google's own documentation on 2026-08-24, and that check **corrected four assumptions** and
surfaced **three facts that change what you must do**:

| Assumption | Reality |
|---|---|
| roles `user` / `assistant` | **`assistant` appears nowhere in Google's docs** — it is an OpenAI convention. Roles are `user` / `model` |
| system prompt is a string | It is a **Content object with `parts`**, spelled `system_instruction` in REST |
| quota exhaustion returns 402 | **402 does not exist in this API.** 429 covers *both* a transient per-minute limit and a hard daily wall |
| invalid key returns 403 | **401** |

### Three things for you, before you create a key

1. **Create an Auth key, not a Standard key.** Google's documentation states: *"On September
   2026: the Gemini API will reject requests from Standard keys."* That is days away.
2. **Use a paid key.** Google's terms distinguish the tiers sharply — unpaid input *"is used
   to provide, improve, and develop Google products"* and *"human reviewers may read,
   annotate, and process your API input and output."* You will be sending transcripts of real
   people's recorded speech. The entire benchmark's LLM bill is about **₹0.42**, so there is
   nothing to save by using the free tier and a consent problem if you do.
3. **`generateContent` is labelled "Legacy."** Google recommends a newer Interactions API for
   new development while stating this one *"remains fully supported"* with **no shutdown
   date**. Used deliberately: its streaming shape is documented well enough to implement
   without guessing, and the benchmark needs one plain sentence.

---

## 3. The adversarial review, and what it caught

22 agents attacked the new surface. **Every finding they raised was confirmed by a separate
verifier who reproduced it against the code.** Six would have cost real money or a real day.

### Would have cost the entire end-to-end sweep

**The SSE parser split frames on a hard-coded `\n\n`.** The specification permits LF, CR or
CRLF. On a CRLF stream *no frame is ever dispatched*: the whole response accumulates, is
discarded when the connection closes, and the adapter reports an empty completion. Reproduced
end to end — 30 turns, every STT call billed, **zero `total_turn` samples**, verdict
INCOMPLETE. Google's own client for this endpoint accepts all three terminators, which is the
strongest available signal about what the server emits. *Fixed: line endings normalised on
append; a test feeds all three separators and asserts identical text.*

**The 429 quota discriminator matched a body Google never sends.** I had written it against
the literal `quota_exceeded`. Google's real envelope carries `RESOURCE_EXHAUSTED` in
`error.status`, *"You exceeded your current quota"* in the message, and the per-day-versus-
per-minute distinction in `details[].violations[].quotaId` — **which sat past the 400-character
truncation in `HttpError`**. A daily wall therefore classified as retryable and the sweep
would have hammered an exhausted quota. *Fixed: real discriminators, per-minute checked
first (its message also says "quota exceeded"), and 2000 characters retained.*

### Would have cost a recording day

**`scaffold` overwrote `references.tsv`.** It guarded only `manifest.json` — while the
founder's transcription work, 80 references and 68 entity expectations, lives in the
worksheet. Re-running it replaced a day of writing with empty rows, and the error message
talked about the manifest. *Fixed: refuses if any of the three files exist.*

**`reference` wrote before it validated.** A bad worksheet left the manifest broken with the
previous good state gone, and the merge would silently delete any utterance the worksheet did
not mention. *Fixed: validates a candidate file first, writes only on success, and refuses
outright rather than dropping ground truth somebody wrote.*

### Would have made a rule guard nothing

**The dual-script rule was satisfiable by a single reference.** `detectScript` returned
`mixed` for any string containing one Devanagari character, and `mixed` was treated as
covering both alphabets — so a romanised sentence with one Devanagari word passed, with no
alternate at all. The rule I had just added to protect the Hinglish sub-gate protected
nothing. *Fixed: script detection is now by dominance (60% of letters), and the rule requires
two genuine references.*

**An empty code-mixed cohort produced no message at all.** `if (size === 0) continue` meant a
corpus with no code-mixed utterances passed validation silently, and the Hinglish sub-gate —
the strongest reason this benchmark exists — never applied. *Fixed: an error for a
deciding-sized corpus, a warning for a small smoke corpus.*

### Also fixed

- A blocked prompt was filed as **our** defect rather than the provider's refusal — which
  excused the provider from a refusal it made, and excluded the sample from the failure gate.
- `redact()` had no pattern for Google's `AIza…` key format, and no bare `key:` label.
- `requireRegion` canonicalised case but the return value was discarded, so `blr1` and `BLR1`
  would have read as two different regions when pooling.
- `parseWorksheet` silently read `''` for every column past a short row — a spreadsheet that
  drops trailing empty cells turned a written reference into a skipped one.
- A quoted CSV export and a byte-order mark both corrupted the worksheet silently.
- `bench consent` did not check retention expiry, so it could pass where a run would refuse.
- The entity DSL corrupted any accept form containing a delimiter — **and `CI/CD` is in this
  project's own frozen line set**, so `["CI/CD"]` became `["CI", "CD"]`: an expectation no
  provider could satisfy, scored against all of them, invisible in the output.
- `maxOutputTokens` raised from 120 to 512: for this model family thinking tokens count
  against the same budget, and a completion that spends its allowance reasoning would look
  like a slow, unhelpful provider.

---

## 4. Tested

| Suite | Result |
|---|---|
| Benchmark | **306 passed** across 14 files |
| API (Testcontainers, real PostgreSQL) | **401 passed** across 20 files |
| Production-boundary | **6 passed** |
| `pnpm -w lint` · `pnpm -w typecheck` | clean |

New this phase: **39 tests** covering the region gate, consent completeness, dual-script
enforcement, cohort floors, the scaffold and worksheet round trip, the Gemini request shape,
and the 429 discrimination.

### Verified by running it, not by reading it

| Check | Result |
|---|---|
| `bench scaffold` | 80 slots, 16 conversations, 55 quiet / 25 noisy, correct language split, consent block pre-filled with all five processors |
| `bench scaffold` re-run | **refuses** — names all three files it would have overwritten |
| `bench consent` on an unfilled scaffold | **refuses** — catches every placeholder date, contact and processor description |
| `bench consent` once filled | passes, and states why the LLM is on the list |
| `bench reference` with a bad worksheet | manifest **unmodified**, no temp file left behind |
| `bench reference` with good rows | merges, then validates, and reports missing audio per utterance |
| `bench doctor` | lists all five adapters including `gemini`, and reports the region as declared-not-verified |
| `bench run` without a region | **refuses**, before `--confirm`, free |
| `bench run` with a region, no `--confirm` | prints the plan including `region: BLR1 (declared, not verified)`, creates nothing |
| `bench plan --rates` | **7 runs** — the end-to-end run is now executable and counted |

---

## 5. Ready / not ready

### READY — nothing further needed from me

- The end-to-end run, which is the only run that measures the 1200 ms gate.
- The region gate, consent enforcement, dual-script enforcement, cohort warnings.
- The recording workflow: scaffold → consent → record → worksheet → merge → validate.
- Cost estimation, including a Gemini rate entry from the pricing page read today.

### REQUIRES MANUAL WORK — yours

| # | What | Notes |
|---|---|---|
| 1 | **Create the five provider accounts and keys** | Gemini: **Auth key, paid tier**. See §2 |
| 2 | **Provision the BLR1 VM**, install Node + ffmpeg, set `BENCHMARK_REGION=BLR1` | Not on a laptop |
| 3 | **Ask Sarvam where audio is processed** | Undocumented; the consent wording depends on it |
| 4 | **Read Azure's Central India S0 rates in a browser** | The pricing page renders placeholders to a fetcher |
| 5 | **Fill the consent block and sign with real speakers** | `bench consent` tells you exactly what is missing |
| 6 | **Record 80 utterances**, 2+ speakers from different states | `RECORDING_SHEET.md` is printable |
| 7 | **Write 80 references + 35 Devanagari alternates + ≥68 entity expectations**, then freeze | In a spreadsheet. This is the long part |
| 8 | **Read the Stage 1 smoke-test output** and confirm each adapter | Judgement about whether a response is what was expected |

### STILL NOT VERIFIED AGAINST A REAL PROVIDER

**Nothing has been.** Every adapter, Gemini included, carries `unverified: true` and an
`adapterVersion` ending in `-unrun`, asserted by a test. The twelve open questions in
`PROVIDER_ADAPTER_VERIFICATION_REPORT.md` §5 are unchanged, and Gemini adds two:

- Whether the server emits LF, CR or CRLF frame separators (now handled either way).
- The requests-per-minute ceiling — Google no longer publishes per-model rate limits and
  defers to the AI Studio console, so it cannot be read from documentation.

---

## 6. What I would watch for next

The confirmation rate in this review was again very high — every finding raised was
reproduced. I do not think that means the reviewers were infallible; I think it means the new
surface was young. The Gemini adapter in particular is **hand-written SSE parsing against a
service nobody here has ever called**, and Stage 1 of `FIRST_BENCHMARK_RUN_PLAN.md` exists
precisely to meet it cheaply: **one utterance, seven provider calls, read by hand.**

Do that before anything longer. It is where the remaining unknowns become known for a few
rupees instead of a sweep.

---

*Every figure in this report was produced by running the code. Where something was not run,
this report says so.*
