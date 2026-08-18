# AI Agent Platform — Project Context

## Purpose

This repository will become the foundation for a provider-independent, multi-tenant AI agent platform for business workflows.

## Initial commercial wedge

Recruitment screening + interview scheduling.

Recruitment is the first proving ground, not the permanent identity of the company.

## Long-term vision

Build a business AI-agent platform where organizations can create, configure, deploy, monitor, and optimize AI agents for workflows such as:

- Recruitment
- Sales
- Customer support
- Promotions
- Appointment booking
- Operations
- Other repetitive business workflows

## Geographic strategy

- Phase 1: India
- Phase 2: Global expansion after product-market validation

## Commercial boundary

Organizations are the primary commercial and tenancy boundary.

Users belong to organizations through **memberships**, and each membership carries role-based permissions. A user may belong to several organizations with a different role in each (ADR-005).

The platform should not primarily price per user.

## Bootstrap constraint

Target development/testing operating budget: approximately ₹10,000/month.

Infrastructure is expected to consume approximately **₹2,000–4,500/month** through Phases 1–4 (ADR-006), leaving the majority of the budget for provider usage, which is where it should go. Managed PostgreSQL and Redis add to this from Phase 5.

This is a development constraint, not a permanent customer-usage limit.

Customer usage should ultimately be funded by customer revenue.

## Core principle

Customers configure business capabilities, not infrastructure providers.

Customers should see concepts such as:

- Standard/Premium voice
- Standard/Advanced/Premium intelligence
- Languages
- Calling capacity
- Knowledge capabilities
- Integrations

They should not be required to understand or directly manage the underlying LLM, STT, TTS, or telephony provider.

## Provider independence

The platform must keep these layers replaceable:

- Telephony
- STT
- TTS
- LLM
- Embeddings
- Vector storage
- Calendar
- CRM/ATS
- Notifications

Do not hard-code business logic to a provider SDK.

## Quality principle

Do not deliberately reduce customer-facing quality merely to hit the bootstrap budget.

Reduce scope before reducing core reliability, knowledge accuracy, conversation quality, or safety.

## Current development status

**Architecture approved, 2026-08-16.** ADR-001 through ADR-007 are ACCEPTED and consolidated in `12_ARCHITECTURE_DECISIONS_FINAL.md`. The specification pack has been updated to match.

Phase 1 (Foundation) may begin on founder instruction. Its exact boundary is defined in `12_ARCHITECTURE_DECISIONS_FINAL.md`.

Still open and not approved: hosting vendor selection, and all AI/telephony provider selection. Both remain experimental decisions pending real benchmarking, and neither blocks Phase 1.

Do not start implementing the entire platform. Work phase by phase.

## Important instruction

When implementation begins, work incrementally. Do not build the entire product from one prompt.

Every implementation task must:

1. State exactly what is being built.
2. State what must not be changed.
3. Include tests.
4. Preserve tenant isolation.
5. Preserve provider abstraction.
6. Avoid unnecessary dependencies and infrastructure.
