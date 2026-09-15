# Phase 5B — Licensed Telco and India CPaaS Research

**Date:** 18 August 2026. Every claim re-fetched from the provider's own pages on that date.
**Method:** 7 parallel research agents + 2 adversarial verifiers, ~274 tool calls. Corrections from
the verification pass are folded in and marked.
**Status:** research only. No provider selected, nothing installed, no adapter written.

---

## 0. The one requirement that decides everything

The platform already has its own runtime, tool authorization, knowledge retrieval and safety limits.
What it needs from a carrier is narrow:

> **Bidirectional real-time audio streaming to OUR OWN websocket, with an Indian outbound caller ID,
> on a domestically routed call.**

That single requirement eliminated four of the seven providers researched — and it eliminated them
for a specific, checkable reason each time, not for lack of looking.

**A distinction that mattered repeatedly:** several providers sell a "voice AI" product. That is not
the same as "we will stream audio to your endpoint". A bundled bot you rent is the opposite of what
this platform needs — it would replace the layer that differentiates the product. The research was
instructed to treat those as different claims, and the adversarial verifier specifically hunted for
places where one had been mistaken for the other.

---

## 1. Results at a glance

| Provider | Licensed telco? | Bidirectional WS to our endpoint | Published pricing | Classification |
|---|---|---|---|---|
| **TTBS Smartflo** | **Yes** | **Yes — fully specified** | **Yes** | **PRIMARY CANDIDATE** |
| **Knowlarity** (Gupshup) | No — CPaaS | **Yes — best audio spec found** | Partial (streaming price absent) | **BACKUP CANDIDATE** |
| **Exotel** | No — UL-VNO | **Yes — Voicebot applet** | Plans only, no per-minute | **BACKUP CANDIDATE** |
| **Airtel IQ** | **Yes** | **No — verified absent** | No | **NOT SUITABLE** |
| **Ozonetel** | No | **No — verified absent** | Partial | **NOT SUITABLE** |
| **Tanla** | No — DLT operator | **No** | No | **NOT SUITABLE** |
| **Jio (JioCX)** | **Yes** | **No** | No | **NOT SUITABLE** |
| **Tata Communications / Kaleyra** | **Yes** | Unknown — docs login-gated | No | **UNVERIFIED** |

---

## 2. TTBS Smartflo — PRIMARY CANDIDATE

**Tata Tele Business Services.** A licensed Indian carrier that publishes both real pricing *and* a
complete bidirectional streaming specification. That combination did not exist anywhere else in this
research, and it makes TTBS the first credible **licensed-telco** second source to Plivo.

### Streaming — fully specified, and close to Twilio-compatible

From [docs.smartflo.tatatelebusiness.com](https://docs.smartflo.tatatelebusiness.com/docs/bi-directional-audio-streaming-integration-document.md),
verified verbatim by the adversarial pass:

> "enables to send us the voice data along with the information of the caller to the endpoint
> (webSocket) which can return the voice data back and it would be played on the call"

**You supply the endpoint** — the SOP asks the customer for the "wss URL of their VOICE Bot for
Bi-directional streaming".

| Property | Value (OFFICIAL) |
|---|---|
| Encoding | `audio/x-mulaw` (G.711 μ-law / PCMU) |
| Sample rate | 8000 Hz |
| Bit rate / depth | 64 kbps / 8-bit, mono |
| Payload constraint | "at least 160 bytes or a multiple of 160 bytes" |
| Inbound events | `connected` · `start` · `media` · `stop` · `dtmf` · `mark` |
| Outbound events | `media` · `mark` · `clear` |

This is essentially the Twilio Media Streams shape, which materially reduces integration cost — one
adapter interface plausibly covers Plivo, TTBS and Twilio.

### Pricing — published, and this is rare

From [tatatelebusiness.com/cloud-and-saas/smartflo](https://www.tatatelebusiness.com/cloud-and-saas/smartflo/),
all **OFFICIAL**, verified verbatim from raw HTML:

| Plan | One-time | Recurring |
|---|---|---|
| **Voice Streaming Unlimited (Outbound & Inbound)** | **₹20,000** | **₹1,100 per concurrency/month** |
| Smartflo OBD Unlimited | ₹10,000 | ₹1,200 per concurrency/month |
| Smartflo Lite | ₹5,000 | ₹950 per licence/month (**min. 3-month tenure**) |
| Smartflo Pro | ₹10,000 | ₹1,250 per licence/month |
| Smartflo ITS | ₹10,000 | ₹1,000 per licence/month |
| Smartflo API C2C (usage-based) | ₹20,000 | ₹25,000 / ₹1,00,000 / ₹5,00,000 platform fee/month |
| Smartflo OBD (usage-based) | ₹20,000 | same three tiers |

Voice Streaming Unlimited includes: "Unlimited calling within India*", PSTN-based calling, **1
Standard DID per concurrency**, call recording retention 6 months, "IVR: No Limitations".

### ⚠ The asterisk matters — "unlimited" is 5,000 minutes

The initial research reported the fair-usage threshold as unpublished and told the founder to extract
it from sales. **The adversarial verifier found it published on the same page**, as a footnote
directly beneath the plan card:

> **"* Unilimited plan as per Fair Usage Policy - 5000 mins per user per month (pooled)"**

**This changes the economics materially**, and it is corrected throughout. Voice Streaming Unlimited
is a **5,000-pooled-minute** plan, not an unlimited one.

**Open ambiguity worth a written answer:** the footnote says "per user", but Voice Streaming
Unlimited is priced *per concurrency*, not per user or licence. Whether one concurrency counts as one
"user" for FUP purposes is unstated and changes the effective allowance by an unknown multiple.

### Eligibility — no entity floor, and this was overstated before

The initial pass concluded a solo founder "is not the target buyer". The verifier checked the actual
qualification form and the Terms, and that was too pessimistic:

- Terms define Customer as **"the individual or entity or person who or which has applied"** — no
  entity-type floor, and no minimum contract tenure in the general terms.
- Qualification form brackets bottom out at turnover **"Less than 5 Cr"** and employees **"0 - 24"**.
  There is no bracket a solo founder cannot honestly select.
- **GST is optional.** The Terms say quote your GSTIN, and then: *"If you do not quote your GST
  registration number it shall be presumed that you are unregistered for tax purposes."*
- **Mandatory instead:** a valid signed CAF plus **POI and POA** (proof of identity and address).

> **The barrier is price and paperwork, not eligibility.** That distinction is actionable: a
> ₹20,000 setup fee is negotiable; an eligibility bar is not.

### What is missing or unresolved

| Gap | Why it matters |
|---|---|
| **No webhook signature / HMAC** documented | Our `TelephonyProvider.verifyWebhook()` contract assumes signed payloads. This is a real security downgrade requiring a shared-secret header plus `ref_id` reconciliation. |
| **No per-minute rate published** | Only plan pricing exists. |
| **Media anchoring / residency unstated** | No page says where the media server terminating your `wss` session sits, or whether audio leaves India. Get it in writing if DPDP residency matters. |
| **Mobile caller ID unconfirmed** | API says `caller_id` "must be a valid DID assigned to the Smartflo account"; whether mobile-series DIDs are purchasable is unstated. Material for candidate pickup rates. |
| **CPS is account-specific** | The API rate limit **equals assigned CPS** ("If CPS is 3, the rate limit will be 3 requests per second"). What a 1-concurrency account gets is unpublished. |
| **Broadcast/outreach campaigns not supported on the streaming path** | "not yet supported (planned for future)". Streaming works via inbound UIX and **outbound Click-to-Call** only. |
| **No free trial, no self-serve** | Every CTA is "Enquire Now". |
| **Minimum tenure on Voice Streaming** | Only Lite prints one (3 months). Silence is not absence in a CAF contract. |

**Corrected from the first pass:** the claim that "voice streaming must be manually enabled by the
Tata support team" is **not supported by the documentation**. The SOP states only a prerequisite —
"You have enabled access to Channels Hub on the account" — and does not say who performs it.

**Highest-value question to put to TTBS sales:** *is the ₹20,000 Voice Streaming setup fee waivable,
deferrable or amortisable for a 1-concurrency micro account?*

---

## 3. Knowlarity — BACKUP CANDIDATE (materially stronger than the earlier pass could see)

A Gupshup company. The Phase 5 research could not read a single Knowlarity page because of a TLS
certificate problem. This pass got through, and the finding changes the assessment.

### Streaming — the best audio specification found in this entire research

From `developer.knowlarity.com`, Chapter 2 — a real protocol reference, not marketing:

| Property | Value (OFFICIAL) |
|---|---|
| Protocol | **WSS only** — "plain WS is not accepted" |
| Direction | **Knowlarity connects to YOUR server** — "you are the server" |
| Endpoint | Any path you choose, set in the IVR Stream Node `wss-url` |
| Concurrency | **One websocket per active call** |
| Inbound audio | **Linear PCM, 16-bit signed little-endian, mono, binary frames** |
| **Sample rate** | **Selectable: 8k / 16k / 24k / 32k / 48k Hz** — 16k "Recommended. Wideband quality. Supported by all major STT/TTS services." |
| Frame size | ~640 bytes = 20 ms at 16 kHz |
| Outbound control | JSON text frames — `playAudio` and others |

**This is better than μ-law 8 kHz** and it is the only provider offering a choice of sample rate.
Worth tempering against the finding in the earlier research: audio from an Indian mobile has already
been through narrowband transcoding, so requesting 16 kHz may deliver upsampled 8 kHz rather than
genuine wideband. **Still, having the option is strictly better than not having it.**

**A documented protocol quirk to budget for:** the first metadata frame is *"a JSON-encoded string
wrapping a Python-style single-quoted dict"* — you must parse twice, and in TypeScript you will need
a tolerant parser for single-quoted pseudo-JSON. Knowlarity documents this themselves. Budget an hour.

### Pricing — partially published

All **OFFICIAL** from [knowlarity.com/pricing/voice](https://www.knowlarity.com/pricing/voice):

| Item | Rate |
|---|---|
| **Click-to-Call outbound** | **₹0.40/min** |
| Virtual Number — Advance | ₹16,800/year + ₹0.30 per 30 s outgoing |
| Virtual Number — Premium | ₹34,200/year + ₹0.20 per 30 s |
| Cloud Contact Center | ₹1,999 / ₹2,999 / ₹3,499 per month |
| Softphone WebRTC | ₹1,499–1,999 per agent/month (10-agent tiers) |
| Toll Free | ₹21,000 / ₹28,800 / ₹46,200 per year; incoming ₹1.05/min |
| **Voice Streaming (the feature we need)** | **NOT PUBLISHED** |

### Three problems that keep it out of the primary slot

1. **⚠ A published TRAI gate on our exact use case.** Call API docs, verbatim:
   > *"Please be noted that Transactional campaigns are not allowed by default due to legal
   > restrictions set by TRAI. If you wish to avail this feature, please get in touch with our
   > support team to help you get the required clearance."*

   Knowlarity must obtain clearance for you before outbound screening runs at scale. This is the
   clearest carrier-side evidence found that the classification question in
   `PHASE_5B_PROVIDER_VALIDATION.md` §4 has real operational teeth.

2. **One-year minimum contract, quarterly advance payment** (verbatim from the Softphone WebRTC
   block). The worst commercial shape in this research for a bootstrapped founder.

3. **Outbound topology mismatch.** `makecall` is documented as *"The first call is placed to agent
   number, and it is then connects with the customer"* — agent-first two-leg bridging. There is no
   human agent in our model. Whether a clean single-leg originate is available is unresolved and is
   the question that would promote Knowlarity to primary.

**DLT:** the string "DLT" appears **zero times** across the entire developer portal.

---

## 4. Exotel — BACKUP CANDIDATE

Technically the strongest India-domiciled fit; commercially the least committable.

### Streaming — two applets, and the difference is the whole decision

- **Stream applet** — **unidirectional, receive-only.** No audio back, no DTMF. Useless for a
  conversational agent.
- **Voicebot applet** — **bidirectional.** Both directions on one socket, plus DTMF events. Raw
  16-bit little-endian mono PCM, base64-encoded inside JSON frames. Not a proprietary codec, not a
  vendor SDK, not a bundled bot.

### Eligibility — the broadest verified in this research

The KYC page enumerates: registered companies (Private Ltd, Nidhi Ltd), partnerships including LLPs,
NGOs/trusts/societies, **sole proprietorships**, and **foreign entities**. Sole proprietors need GST
or MSME registration, proprietor PAN and address proof. India data region at `api.in.exotel.com`
(Mumbai); claims "PCI DSS, DLT, TRAI, and UL-VNO compliant".

### Pricing (OFFICIAL) and the gap

| Item | Value |
|---|---|
| Dabbler | ₹9,999 / 5 months / 5,000 credits / 1 number / 3 agents |
| Believer | ₹19,999 / 11 months / 9,500 credits |
| Influencer | ₹49,499 / 11 months / 39,000 credits |
| Credit unit | 1 credit = ₹1 |
| Free trial | 7 days, 500 credits |
| **Exotel for Startups** | **₹6,000 credit value across 6 months** |
| **Per-minute voice rate** | **NOT PUBLISHED** |
| **AgentStream streaming surcharge** | **NOT PUBLISHED** |
| **Concurrency** | **NOT FOUND — the most damaging gap** |

**Credits expire with the plan**, so the plan price is a floor cost regardless of usage. The
**Exotel for Startups programme is worth investigating** — ₹6,000 of credit is a real pilot for a
bootstrapped founder, and it was not surfaced in the Phase 5 research.

**The blocker:** the Voicebot applet reportedly requires a human at Exotel to enable it. For a
pre-revenue founder with no account manager, that is a real risk of simply never being enabled.

---

## 5. Airtel IQ — NOT SUITABLE

A licensed telco, and the disqualification is unusually well evidenced.

### There is no media plane at all

Verified **two independent ways**:

1. The complete **OpenAPI 2.0 spec**, extracted from Airtel's own `api-docs` JS bundle
   (`host: openapi.airtel.in`, `basePath: /gateway/airtel-xchange`). It defines exactly **seven
   operations**: `clickToCall`, `clickToCallV2`, `executeWorkflow`, `executeWorkflowV2`,
   `getCallDetails`, `getCallDetailsV2`, `receiveClientEvent`. None streams media.
2. **Grepping all 21 dashboard JS bundles (16 MB):** `mediaStream` 0 hits · `audioStream` 0 ·
   `streamUrl` 0 · `sipUri` 0 · `mulaw` 0. Exactly one `wss://` occurrence, which resolves to a
   generic gateway URL in a config object.

The call-flow model is `audioURL`-based playback plus `collectDtmf`. You upload a file; Airtel plays
it. There is no path for live audio to reach our stack.

### Commercial findings worth recording anyway

All **OFFICIAL**, extracted from the prepaid Terms embedded in the dashboard bundle:

- **GST haircut on top-ups:** *"INR 1 payment shall result in approximately 0.85 credit points being
  added to Customer's account"* — **~15% of every recharge is gone before you buy a single minute.**
- **90-day credit expiry:** *"Unused credits shall expire ninety (90) days from the date of
  purchase"*, and *"no refund shall be made to the original payment source"*.
- **Minimum recharge exists but is never quantified** — *"specified by Airtel from time to time"*.
  A genuine risk that it exceeds a ₹10,000 monthly budget, undiscoverable before signup.
- Free trial: **1 Intelliphone + 500 pulses.** Pulse can be 15, 30 or 60 seconds — 60 s pulsing would
  materially hurt a short-call screening workload.
- No voice rate card is public anywhere.

**Correction from the verifier:** Airtel *does* publicly sell **SIP trunking**
([airtel.in/b2b/sip-trunk](https://www.airtel.in/b2b/sip-trunk)). That is the only Airtel path that
could ever carry media to our own stack. Its commercials, channel counts, and whether they will
terminate to a customer-controlled media server are all unpublished. **Recorded as the one open
Airtel avenue**, not as a recommendation.

---

## 6. Ozonetel — NOT SUITABLE

**Evidence of absence, not absence of evidence.** Ozonetel publishes `docs.ozonetel.com/llms.txt` — a
complete machine-readable index of every documentation page and OpenAPI endpoint. The full published
surface was enumerated: outbound dial (8 variants), DID CRUD, campaign CRUD, agent CRUD,
dispositions, recording pause/resume, CDR reports, conference call-control, event subscriptions.
**No media streaming endpoint of any kind.**

Published pricing (OFFICIAL): KooKoo outbound **₹0.70/min** · local virtual number ₹150–800/month ·
toll-free ₹1,000–3,000/month · international ₹3–6/month. The main pricing page remains unreachable.

`originate()` maps cleanly (`PhoneManualDial`, returns a UCID, `did` gives explicit Indian caller-ID
selection). The audio path does not exist.

---

## 7. Tanla — NOT SUITABLE for the media path

Across 14 official pages: **"websocket" never appears**, no codec named, no sample rate named, no
media-stream API described. The voice product is pre-recorded outbound dialling plus hosted IVR —
*"Deliver personalised audio messages to customers in their local language"*. All pricing
NOT_PUBLISHED.

**But note what Tanla is:** they operate **Trubloq**, DLT infrastructure for Indian telcos. That is
irrelevant to our media path and potentially **very relevant to the DLT registration and
header/series problem** flagged in the validation document. Worth a conversation on compliance
tooling even though they cannot carry the call.

---

## 8. Jio (JioCX) — NOT SUITABLE

**No publicly documented self-serve CPaaS voice API** — that is the headline finding, not a search
failure. Everything published describes a legacy pre-recorded-audio and DTMF stack: Click-to-Call,
Smart IVR, Missed Call, Voice OTP, OBD ("send pre-recorded messages"). The only media formats named
anywhere are **"WAV, MP3, etc."** — you upload a file and Jio plays it.

`developer.jiocx.com` loads but is a navigation hub behind a Log In / Sign Up wall; no API reference
is publicly readable. Across seven pages: zero mentions of bidirectional streaming, websockets, media
forking, or any customer-controlled media endpoint.

---

## 9. Tata Communications / Kaleyra — UNVERIFIED

**Deliberately not classified NOT SUITABLE**, on the verifier's correction: *"Absence of evidence
from a login-gated docs portal is not evidence of absence."*

- `kaleyra.com/product/scalable-voice-api/` → HTTP 301 to `tatacommunications.com/kaleyra/cpaas/voice`
- `comms.tatacommunications.com/docs/index.html` → **DNS-dead** (HTTP 000)
- `developers.kaleyra.com/support/home` → 302 to a login page
- `apidocs-voice.kaleyra.com` → JavaScript-only shell

Their public voice-AI product (Commotion) is explicitly a **closed bundled bot** — the wrong shape.
Pricing is quote-only, though the Voice page does mention sandbox environments and *"Flexible,
pay-as-you-go pricing with volume discounts… Custom enterprise bundle plans available through the
sales team"*.

**Accurate statement:** Tata Communications/Kaleyra publish no evidence of a customer-endpoint media
streaming capability on any reachable page. Whether their gated Voice API offers one is **unknown**.

---

## 10. Telephony cost comparison — and a non-obvious conclusion

| Option | Structure | Effective ₹/min at 2,500 min/mo |
|---|---|---|
| **Plivo India** | ₹0.38/min + ₹200/mo number | **₹0.46** |
| **TTBS Voice Streaming** | ₹20,000 once + ₹1,100/concurrency/mo, 5,000 min FUP | ₹1.11 (12-mo amortisation) |
| **Knowlarity C2C** | ₹0.40/min + number plan (₹16,800/yr Advance) | ₹0.96 |

**Break-even, TTBS vs Plivo, 12-month amortisation of the setup fee:**

| Minutes/month | Plivo | TTBS | Cheaper |
|---|---|---|---|
| 500 | ₹390 | ₹2,767 | **Plivo** |
| 1,000 | ₹580 | ₹2,767 | **Plivo** |
| 2,500 | ₹1,150 | ₹2,767 | **Plivo** |
| 5,000 | ₹2,100 | ₹2,767 | **Plivo** |

> **Plivo is cheaper than TTBS at every volume up to the TTBS fair-use ceiling.** Beyond 5,000
> minutes you need a second concurrency, which resets the comparison. **TTBS is therefore not a cost
> play at bootstrap scale — it is a licensed-carrier, compliance-posture and second-source play.**
> That is a legitimate reason to want it, but it should be chosen for that reason, not on price.

---

## 11. What this research changes

1. **A real second source now exists.** Phase 5 concluded Plivo was a single point of failure with no
   contractual recourse. TTBS Smartflo is a licensed carrier with published pricing and a documented
   streaming contract — genuine business continuity, at a price.
2. **Knowlarity was wrongly written off.** A TLS failure in the first pass hid the best audio
   specification in the entire research. It is now a backup candidate with one question standing
   between it and primary.
3. **Licensed telcos are not automatically better.** Airtel IQ and Jio are both licensed carriers and
   both are architecturally incapable of what this platform needs. Being a telco does not imply a
   modern media plane.
4. **A carrier has independently confirmed the regulatory risk.** Knowlarity's own docs say
   transactional campaigns "are not allowed by default due to legal restrictions set by TRAI". That
   is carrier-side corroboration that the classification question is operational, not theoretical.
5. **Two commercial traps found that would not appear in any comparison table:** Airtel's ~15% GST
   haircut on every top-up with 90-day expiry, and TTBS's "unlimited" being 5,000 pooled minutes.

---

## 12. Questions to put in writing

**TTBS Smartflo** — is the ₹20,000 setup fee waivable or deferrable for 1 concurrency? Does one
concurrency count as one "user" for the 5,000-minute FUP? What CPS is assigned? Is there a minimum
tenure on Voice Streaming? Where does the media server terminating our `wss` session sit? Can you
provide a **mobile-series** caller ID? What is the webhook authentication scheme?

**Knowlarity** — what does Voice Streaming cost? Is a **single-leg** outbound originate available
(without an agent leg)? What is involved in obtaining TRAI clearance for transactional campaigns, and
how long does it take? Is the 1-year minimum negotiable?

**Exotel** — per-minute rate and AgentStream surcharge? Is the Voicebot applet self-serve or
manually enabled? What concurrency does each plan support? Does the Startups programme apply to us?

**Tanla** — can you provide DLT registration and header/series provisioning as a service, independent
of carrying our voice traffic?

---

*Corrections to earlier claims: `PHASE_5B_PROVIDER_VALIDATION.md`. Cost model:
`PHASE_5B_UNIT_ECONOMICS.md`. Scoring and final classification: `PHASE_5B_DECISION_MATRIX.md`.*
