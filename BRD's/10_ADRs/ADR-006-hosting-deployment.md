# ADR-006 — Hosting and Deployment

**Status:** ACCEPTED WITH CONDITION — approved by founder, 2026-08-16
**Condition:** The *architecture* is approved — Indian region, always-on container, persistent WebSocket, Voice Gateway, no serverless on the voice path. The **specific vendor and cost selection remains an open experimental decision** and must be validated by real benchmarking before any spend is committed. See `12_ARCHITECTURE_DECISIONS_FINAL.md` §D.
**Date:** 2026-08-16
**Resolves:** `03_SYSTEM_ARCHITECTURE.md` §21, which states only "prefer low-idle-cost infrastructure" and "do not choose serverless blindly if real-time voice latency makes it unsuitable".

> **Verification note.** All prices and region availability below are indicative and reflect general market shape, not a quote. Per `06_PROVIDER_AND_COST_SPEC.md` §16 — "store benchmark results rather than making decisions from vendor marketing claims" — every figure must be confirmed against current vendor pricing before commitment.

---

## Context

Hosting is usually a low-stakes decision. Here it is not, because of two hard requirements that most SaaS products do not have.

### Requirement 1 — outbound calling forces an always-on public endpoint

The outbound screening call flow is:

```
Backend → telephony REST API: originate call
        → provider dials the candidate
        → candidate answers
        → provider opens a media stream (WebSocket/SIP) BACK to our public endpoint
        → our Voice Gateway holds that socket for the call duration
        → STT ⇄ Agent Runtime ⇄ LLM ⇄ TTS loop runs in-process
        → call ends; events, usage, and cost are persisted
```

Three consequences follow directly:

- We must expose a **stable, publicly reachable, always-on `wss://` endpoint**. The provider dials us back; we cannot be cold.
- Call state (conversation history, turn state, barge-in buffers) lives **in the process holding the socket**, so a call is pinned to one instance for its lifetime.
- **Concurrency and spend limits must be enforced before dialling**, not after. Coding rules §15 forbids uncontrolled outbound calls.

This eliminates request-response serverless — Lambda, Vercel functions, and similar — on cold starts, execution time limits, and the absence of a persistent process.

### Requirement 2 — latency budget, and why geography decides it

Target: **under ~1.2s from end of candidate speech to first audio byte returned**, p50. Beyond roughly 1.5s the conversation stops feeling like a conversation.

Indicative budget:

| Segment | Typical |
|---|---|
| Endpointing / VAD | 200–400 ms |
| STT finalisation | 50–200 ms |
| LLM time-to-first-token | 300–700 ms |
| TTS time-to-first-byte | 100–300 ms |
| Network legs (within India) | 40–120 ms |
| **Total** | **~700–1700 ms** |

The budget is already tight before geography enters. Hosting compute outside India adds roughly **150–250 ms of round-trip on the telephony leg alone**, and that penalty is paid on *every conversational turn*. It is the difference between a system that feels responsive and one that feels broken.

**Therefore: compute must be in an Indian region.** This is the single most consequential line in this ADR.

---

## Options considered

### Option A — Single VPS in an Indian region, Docker Compose

DigitalOcean Bangalore (BLR1), AWS Lightsail Mumbai, or Linode/Akamai Mumbai. Roughly $24–48/month for 4 vCPU / 8 GB.

**Advantages**
- Cheapest path that satisfies the Indian-region requirement — comfortably inside ₹10,000/month with room for provider spend.
- Always-on process, no cold starts, ideal for long-lived WebSockets.
- Database colocated with the application: sub-millisecond query latency, which matters inside the audio loop.
- Effectively zero lock-in — it is Linux and Docker. Moving is a `docker compose up` elsewhere.

**Disadvantages**
- We are the operations team: patching, backups, TLS renewal, monitoring, incident response.
- Single point of failure; no automatic failover.
- Self-hosted PostgreSQL backups are our responsibility, and getting point-in-time recovery right is real work.
- Manual vertical scaling.

### Option B — Container PaaS with an Indian region (Fly.io, BOM)

Fly.io runs persistent Firecracker VMs, supports WebSockets, and has a Mumbai region. Render and Railway are ruled out for this workload on region grounds — their nearest points of presence are Singapore, which reintroduces the latency penalty this ADR exists to avoid.

**Advantages**
- Minimal operations; good deployment ergonomics; persistent processes suited to voice.
- Mumbai region available; anycast routing.
- Straightforward horizontal scaling when the time comes.

**Disadvantages**
- Higher per-unit cost than a raw VPS for equivalent resources.
- Platform reliability has been uneven historically; for an always-on voice path that is a real risk.
- Managed PostgreSQL offerings on this tier are less mature than a dedicated provider's.
- Some configuration lock-in, though modest.

### Option C — Managed cloud (AWS `ap-south-1` / GCP `asia-south1`)

ECS Fargate or EC2 with RDS.

**Advantages**
- Best long-term scaling path and the strongest compliance story for enterprise buyers later.
- Everything in one region and one account; mature managed PostgreSQL with point-in-time recovery.

**Disadvantages**
- **Breaks the budget.** A NAT Gateway alone is roughly $32/month before any data processing; add Fargate, RDS, an ALB, and CloudWatch and a realistic floor is $150–300/month — one to two and a half times the entire ₹10,000 target, before a single provider call is made.
- Significant configuration complexity for a team of one or two.
- Slower iteration at exactly the stage where iteration speed matters most.

### Option D — Split: dashboard on a global edge platform, backend and voice on an Indian host

Next.js on Vercel or Cloudflare Pages; NestJS and the Voice Gateway on Option A or B.

**Advantages**
- Frontend gets CDN distribution free, which helps if the customer base later spreads beyond India.
- Backend stays persistent and close to telephony.

**Disadvantages**
- Two platforms to operate, two deployment pipelines.
- Cross-origin cookie configuration for authentication becomes fiddly and is a place security bugs hide.
- Edge platform pricing can spike unpredictably.
- No meaningful benefit while the customer base is India-only — the dashboard is served from India anyway.

---

## Evaluation

| Criterion | A: Indian VPS | B: Fly.io BOM | C: AWS/GCP India | D: Split |
|---|---|---|---|---|
| ₹10k/month budget | Best — ~₹2,000–4,000 | Good — ~₹3,000–6,000 | **Poor — exceeds budget** | Fair |
| **Real-time voice latency** | Best — colocated, always-on | Good — Mumbai, persistent | Good — Mumbai | Good |
| **Outbound calling architecture** | Best — stable always-on endpoint | Good | Good | Good |
| Multi-tenancy | Neutral | Neutral | Neutral | Neutral |
| Security | Fair — we patch it | Good | Best | Fair — cross-origin auth |
| Maintainability | Fair — we run it | Good | Fair — complexity | Poor — two platforms |
| Development speed | Good | Best | Poor | Fair |
| Future scalability | Fair — manual | Good | Best | Good |
| Provider independence | Best — plain Docker | Good | Fair — managed-service gravity | Fair |

---

## Decision

**Option A now, deliberately structured so that Option B or C is a configuration change rather than a rewrite.**

### Phase 1–4 (platform, agents, knowledge, intelligence — no voice yet)

A single Docker Compose stack on one Indian VPS (DigitalOcean BLR1 or AWS Lightsail Mumbai), 4 vCPU / 8 GB:

| Service | Notes |
|---|---|
| Caddy | Reverse proxy, automatic TLS |
| Next.js dashboard | |
| NestJS API | |
| PostgreSQL 16 + pgvector | Colocated |
| `pg-boss` worker | Same image, different entrypoint |
| Cloudflare R2 | Object storage — external, zero egress |

Indicative: ~$24–48/month compute plus R2 ≈ **₹2,000–4,500/month**, leaving the majority of the ₹10,000 budget for provider usage, which is where it should go.

### Phase 5 (voice)

Add a **Voice Gateway as a second entrypoint from the same codebase and repository** — one module, one deployment artifact, two processes. This preserves the modular-monolith mandate in `03_SYSTEM_ARCHITECTURE.md` §2 while letting the CPU-sensitive audio path be scaled and restarted independently of the API. A dashboard deploy must never drop a live call.

At this point, introduce Redis for ephemeral call state and cross-process pub/sub, and only then — the "no new infrastructure without a documented reason" rule in coding rules §3 is satisfied by this concrete need, not by anticipation of it.

### Database progression

1. **Development:** PostgreSQL in Docker on the same host.
2. **Before the first real customer's data lands:** migrate to managed PostgreSQL in an Indian region (DigitalOcean Managed Bangalore, or RDS `ap-south-1`), roughly ₹1,200–2,500/month. Automated backups and point-in-time recovery are worth this once real candidate PII is involved. Self-managed backups are a bad bet against a founder's attention.
3. Until then: automated `pg_dump` to R2 on a schedule, plus WAL archiving, with **a restore actually tested** — an untested backup is not a backup.

### Portability constraints (these are what make the decision reversible)

- Everything runs in Docker; no host-specific configuration.
- Strict 12-factor configuration through environment variables.
- No dependency on any provider-proprietary service beyond S3-compatible object storage.
- OpenTelemetry for instrumentation, so the observability backend is swappable too.

### Cost and safety controls (required by coding rules §15, and non-negotiable)

- Maximum concurrent calls, per organization and platform-wide, checked **before** origination.
- Hard maximum call duration with a server-side timer that terminates the call.
- Daily call and spend caps per organization, and a platform-wide kill switch.
- Spending alerts at configurable thresholds.
- Every provider operation emits a usage event and a cost event, per `06_PROVIDER_AND_COST_SPEC.md` §10.

---

## Rationale

Two constraints do almost all the work here.

**The Indian region requirement is not negotiable** — 150–250 ms of avoidable round trip per conversational turn is the difference between a product and a demo, and it is paid on every turn of every call.

**The ₹10,000 budget rules out managed cloud** at this stage. AWS in Mumbai is the right long-term home and the wrong Phase 1 home; a NAT Gateway costing more per month than the entire compute budget is the clearest signal of that.

Between the VPS and the PaaS, the VPS wins on cost and on the quality of the always-on story, and its main weakness — operational burden — is small while the system is one box running Docker Compose. The insurance policy is portability: because nothing depends on host-specific services, moving to Fly.io BOM or AWS Mumbai later is a deployment change, not an architectural one. That is what makes taking the cheap option now defensible rather than reckless.

Serverless is rejected on the merits, not by reflex — the architecture document already flagged the concern, and the outbound-callback flow above is the concrete reason it does not work here.

---

## Consequences

- We own operations: unattended security upgrades, monitoring with alerting, tested restores, and TLS handled by Caddy.
- Single point of failure is accepted for Phases 1–4. Before onboarding a paying customer, define the recovery-time and recovery-point objectives and revisit.
- In-process call state means horizontal scaling later requires either sticky routing per call or externalised state in Redis. **The Voice Gateway must be written with state behind an interface from the start**, or this becomes an expensive retrofit.
- Deployment is `docker compose pull && up -d` initially; add a GitHub Actions pipeline with migration-on-deploy before the first customer.
- Region choice implies India as the data-residency answer, which should be checked against enterprise buyer expectations early, since it is favourable and worth stating in sales conversations.

---

## Expensive to change later

| Item | Cost to reverse | Why |
|---|---|---|
| **Region choice (India vs elsewhere)** | **Very high** | Latency is structural, and data residency commitments to customers are hard to walk back |
| **Voice Gateway as serverless functions** | **Very high** | Would require rewriting the entire audio path; avoided by this decision |
| In-process call state with no externalisation interface | **High** | Retrofitting distributed call state under a working voice pipeline is painful |
| Self-hosted → managed PostgreSQL | Moderate | Planned migration with a maintenance window |
| VPS → Fly.io / AWS | Low–moderate | Deliberately kept cheap via Docker and 12-factor config |
| Object storage provider | Low | S3-compatible API |
| Observability backend | Low | OpenTelemetry keeps it vendor-neutral |
