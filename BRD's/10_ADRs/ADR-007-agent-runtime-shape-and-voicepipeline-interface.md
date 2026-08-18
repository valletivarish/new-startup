# ADR-007 — Agent Runtime Shape and the VoicePipeline Interface Boundary

**Status:** ACCEPTED — founder direction, 2026-08-16
**Date:** 2026-08-16
**Origin:** Founder amendment issued alongside the approval of ADR-001 … ADR-006.
**Relates to:** ADR-001 (escape hatch), ADR-006 (Voice Gateway as a second entrypoint)

---

## Founder direction, verbatim in substance

> Design the Voice Gateway interface from Phase 1, but don't build the voice system yet.
>
> Don't build ElevenLabs/Twilio/etc. now. But make sure the platform architecture doesn't assume `AgentRuntime = HTTP request → response`, because later we need continuous conversation, streaming, interruptions, tool calls, memory, RAG, and audio events.

---

## Context

ADR-001 and ADR-006 both anticipated voice arriving at Phase 5 and both preserved escape hatches for it. Neither of them prevented the most likely failure: that Phases 2–4 quietly bake a **request/response shape** into the agent runtime, and Phase 5 then discovers that turning a synchronous `handle(input) → output` function into a streaming, interruptible, long-lived conversation is a rewrite of the runtime rather than an addition to it.

The distinction is not about voice providers. It is about the **shape of the runtime's core loop**, which is decided in Phase 2 and is expensive to change afterwards.

### The trap being avoided

```
❌ AgentRuntime.handle(message) → response
```

This shape has no way to express: partial input, a caller interrupting mid-sentence, an utterance that arrives as a stream of audio frames, a tool call that must run while audio continues, or a response that begins emitting before it is complete. Every one of those is required by `03_SYSTEM_ARCHITECTURE.md` §10.

### The shape required instead

```
✅ AgentSession
     ├── consumes an ordered stream of inbound events
     └── emits an ordered stream of outbound events
```

Text chat is then the degenerate case of the same loop — one inbound event, one outbound event — rather than a different mechanism that voice later has to be retrofitted onto.

---

## Decision

**The agent runtime is designed as a stream-shaped, stateful session from Phase 1. The `VoicePipeline` interface is defined in Phase 1. No voice implementation is built until Phase 5.**

### 1. Define in Phase 1 — interfaces only, no implementations

- `VoicePipeline` — the contract between the agent runtime and any future audio transport.
- `TelephonyProvider`, `SpeechToTextProvider`, `TextToSpeechProvider` — declared as interfaces per `03_SYSTEM_ARCHITECTURE.md` §9, with **no adapter implementations and no provider SDK dependencies added**.
- `AgentSession` — the stream-shaped runtime contract described below.

### 2. The runtime contract must accommodate, from the start

| Capability | Why it cannot be retrofitted cheaply |
|---|---|
| Continuous, multi-turn conversation | Session lifetime and state ownership differ fundamentally from request scope |
| Streaming input and streaming output | Buffering to completion is a different control flow, not a flag |
| Interruption / barge-in | Requires cancellation propagating through a live generation |
| Tool calls mid-conversation | Must not block the audio path |
| Conversation memory, structured memory, organization knowledge | Kept distinct per `03_SYSTEM_ARCHITECTURE.md` §13 |
| Audio and lifecycle events | Turn boundaries, silence, hangup, transfer, error |
| Cancellation and timeout | A hard maximum call duration must be able to terminate a live session |

### 3. Build in Phase 1 — the text path only

The only concrete implementation is a text transport that drives the same `AgentSession` loop. This proves the stream shape works end to end before audio exists, and it is what `agents.test` in the dashboard uses.

### 4. Explicitly NOT built now

- No telephony provider integration.
- No STT or TTS provider integration.
- No audio encoding, decoding, resampling, or voice-activity detection.
- No media WebSocket server.
- No provider SDK dependencies of any kind for voice.
- No provider selection. Twilio, Plivo, Exotel, Sarvam, Deepgram, ElevenLabs, OpenAI, Anthropic, and Google remain **candidates behind interfaces**, and none is embedded.

### 5. Verification that the boundary held

Before Phase 5 begins, it must be demonstrable that a voice transport can be added **without modifying the agent runtime** — only by supplying a `VoicePipeline` implementation. If that turns out to be false, the runtime shape was wrong and the fix belongs in Phase 2, not Phase 5.

---

## Rationale

The interface costs almost nothing to define now and is very expensive to introduce later, because by Phase 5 there will be an agent runtime, a workflow engine, a conversation model, and a test suite all written against whatever shape was chosen in Phase 2.

This is the same argument that decided ADR-003: pay a small, known cost at the point where the decision is cheap, rather than a large, uncertain cost at the point where it is structural. The founder's amendment applies that principle to the runtime, and it is correct.

There is a real risk in the other direction — designing an elaborate streaming abstraction for a system that has no audio in it yet, and getting it wrong in ways that only become visible under real latency. That is mitigated by keeping the Phase 1 deliverable to **interfaces plus one concrete text implementation**, not a speculative framework. If the interface proves wrong at Phase 5, it is replaced then; what must not happen is that the runtime *assumes* request/response so deeply that the question cannot be reopened.

---

## Consequences

- Phase 2 (Agent foundation) delivers the `AgentSession` contract and the text implementation, not a request/response handler.
- The conversation and message model must support incremental and partial content, not only complete messages.
- Cancellation and timeout are first-class in the runtime from the start.
- `03_SYSTEM_ARCHITECTURE.md` §7 is amended to describe the runtime as a session loop rather than a linear nine-step procedure.
- Phase 1 adds no voice-related dependencies. The interfaces are type declarations with no runtime cost.

---

## Expensive to change later

| Item | Cost to reverse | Why |
|---|---|---|
| **Request/response runtime shape** | **Very high** | The reason this ADR exists. Free now; a runtime rewrite at Phase 5. |
| Conversation model without partial content | High | Schema and every consumer of it |
| Cancellation added after the fact | High | Must thread through every layer of a live generation |
| The specific `VoicePipeline` method signatures | **Low — by design** | Interfaces with one implementation are cheap to reshape; that is the point of defining them before there are many |
