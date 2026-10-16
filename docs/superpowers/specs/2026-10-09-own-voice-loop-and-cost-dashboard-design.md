# Own voice loop + cost dashboard — design

**Date:** 2026-10-09 · **Status:** approved in session (founder) · **Target:** hiring agent launch by 2026-11-30

## Goal

Stop being an ElevenLabs wrapper for the live call, and know the true cost per completed screen
before going to market. Three engines ("arms") run real hiring screens side by side; the cheapest
arm that passes on quality is the one we launch on.

| Arm (`voice_engine`) | Listening | Thinking | Speaking | Telephony |
|---|---|---|---|---|
| `elevenlabs_agent` (baseline, today) | ElevenLabs | Gemini inside ElevenLabs | ElevenLabs | Exotel via ElevenLabs |
| `own_loop_elevenlabs_voice` | Deepgram Nova-3 | Gemini 2.5 Flash-Lite (Vertex) | ElevenLabs Flash | Exotel → our server |
| `own_loop_sarvam_voice` | Deepgram Nova-3 | Gemini 2.5 Flash-Lite (Vertex) | Sarvam Bulbul v3 | Exotel → our server |

Languages: English (en-IN) and Hindi incl. Hinglish. Hiring use case only.

## Decisions

- Loop built on **Pipecat** (open source, Python) as `apps/voice`, a third container next to `api`
  and `worker`. It owns only the live conversation; **every business rule stays in Nest**.
- Arm is chosen **per job by a platform admin** (`jobs.voice_engine`). Kill switch
  `VOICE_OWN_LOOP_ENABLED=false` forces the baseline.
- The Java backend is dropped (ADR-008 rejected); Nest/TypeScript stays.

## Call flow (own-loop arms)

1. HR clicks Call phone. Nest builds the same screening plan as the baseline (prompt, first message,
   must-ask questions, language — `buildVoiceProvisionConfig`) **without** provisioning an
   ElevenLabs agent, and freezes it in `voice_sessions.provision_snapshot` with the chosen voice.
2. Nest calls Exotel's connect API (`/Calls/connect`, `Url` = the own-loop Voicebot app,
   `StatusCallback` = `/webhooks/exotel`). The returned CallSid is stored as
   `voice_sessions.external_conversation_id`, `provider='own_loop'`, `engine=<arm>`.
3. The candidate answers; Exotel opens the media stream to `wss://<api host>/voice/exotel`.
4. `apps/voice` reads the CallSid from the stream start and fetches the call plan from
   `GET /internal/voice/calls/:callSid` (shared secret, docker network only).
5. Pipeline: Exotel 8 kHz → Silero VAD → Deepgram → Gemini (streamed) → TTS (streamed) → Exotel.
   Agent speaks first; interruptions cut playback; 7 s silence → one re-prompt, two → polite end;
   one tool `end_call(reason)`; hard cap 8 minutes (`VOICE_MAX_CALL_SECONDS`).
6. On end, `apps/voice` posts transcript, usage (call/STT seconds, LLM tokens, TTS characters),
   response-time p50/p90 and interruption count to `POST /internal/voice/calls/:callSid/result`
   (retried with backoff, spooled to disk until accepted).
7. Nest extracts structured answers + summary from the transcript with Gemini (job questions),
   writes them in the same shape the review screen reads today, and prices the call.

Baseline arm is unchanged except that its webhook now works (see below).

## Cost tracking

- **`cost_services`** (platform table): one row per service — key, vendor, what it's used for,
  billing unit (`per_minute`, `per_1k_chars`, `per_1m_tokens_in/out`, `per_credit`,
  `monthly_fixed`), INR rate, status (`in_use`/`testing`/`off`). Readable by the app (pricing);
  writable only in platform-admin context.
- **`call_cost_ledger`** (exists, migration 0025) gains `engine`, `response_p50_ms`,
  `response_p90_ms`, `interruptions`, `quality_rating` (1–5), `quality_note`. One row per call;
  `rate_card` stores the rates snapshot used, so editing a rate never rewrites history.
- Baseline: ElevenLabs-reported credits × ₹/credit + Exotel. Own loop: usage × rates.
- Exotel's actual billed price replaces the telephony estimate when the call details are fetched.

## Platform admin

`PLATFORM_ADMIN_EMAILS` allowlist. After verifying the session, the API sets
`app.platform_admin='on'` inside one transaction; SELECT-only policies on `call_cost_ledger` and
write policies on `cost_services` honour it (same pattern as the 0022 webhook lookup). Customers
never see cross-company data.

`/admin/costs` (web, platform admins only): services registry with editable rates; this month's
spend per service (usage + fixed); arm comparison (calls, completed screens, cost/min,
cost per completed screen, median response time, completion %, average rating); call list.
Testers rate each test call (1–5 + note).

## Webhook fix (baseline)

`handleWebhookEvent` looks the session up under `app.webhook_conversation_id`
(policy `vs_webhook_lookup`, migration 0022), then writes under that session's org context.
Same lookup serves `/webhooks/exotel` and the internal routes (CallSid is the conversation id).

## Security

- `/voice/exotel` accepts a stream only for a CallSid that is a `pending`/`active` own-loop session
  started in the last 10 minutes.
- `/internal/*` requires `x-voice-token == VOICE_INTERNAL_TOKEN`; Caddy returns 404 for it publicly.
- `/webhooks/exotel` trusts nothing in the body except the CallSid; status and price are fetched
  from Exotel's API.

## Failure handling

Provider error mid-call → short apology, hang up, `failed` + `failure_reason='engine_error'`; no
mid-call arm switching. No answer/busy → from Exotel status. Stuck sessions are swept after the cap.
Result delivery is retried and spooled.

## Testing

Nest: webhook lookup fix, internal route auth + call binding, pricing maths, platform-admin RLS
(non-admin sees zero rows), arm selection. `apps/voice`: unit tests + a fake-Exotel client that
streams a WAV over the WebSocket and measures response time. Live round: 10 calls per arm
(English + Hindi) to verified numbers, rated in the dashboard.

## Rollout

1. Cost foundation: webhook fix, registry, ledger, `/admin/costs` (works with baseline calls).
2. Own loop: `apps/voice`, Exotel connect + status callback, arms 2–3, per-job engine setting.
3. Live test round → pick the launch arm.

## Founder actions

Second Exotel Voicebot app pointing at `wss://<api host>/voice/exotel`; keep the ElevenLabs plan
active past 2026-10-15; Exotel KYC before real candidates.
