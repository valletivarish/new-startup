# Claude Context Pack — AI Agent Platform

Use these documents as the project context when implementation begins.

**Architecture approved 2026-08-16.** ADR-001 through ADR-007 are ACCEPTED.

## Read this first

`12_ARCHITECTURE_DECISIONS_FINAL.md` is the single authoritative architecture document. Where it conflicts with an older file, it wins.

## Recommended order

1. `00_PROJECT_CONTEXT.md`
2. `01_PRODUCT_STRATEGY.md`
3. `02_BRD.md`
4. `03_SYSTEM_ARCHITECTURE.md`
5. `04_DATABASE_API_SPEC.md`
6. `05_UX_DASHBOARD_SPEC.md`
7. `06_PROVIDER_AND_COST_SPEC.md`
8. `07_CODING_RULES_FOR_CLAUDE.md`
9. `08_DEVELOPMENT_WORKFLOW.md`
10. `09_MVP_ACCEPTANCE_CRITERIA.md`
11. `10_ADRs/` — ADR-001 … ADR-007
12. `11_PERMISSION_MATRIX.md`
13. **`12_ARCHITECTURE_DECISIONS_FINAL.md`** — authoritative
14. `13_SPEC_CHANGES_REQUIRED.md` — changelog of what the ADRs changed

## Important

These files define the current product/design baseline. They do not authorize Claude to build the entire product at once.

Implementation must proceed in small, reviewable phases.

Provider choices are intentionally not permanently locked. No AI or telephony provider has been selected; all remain behind adapters pending benchmark evidence.

The initial commercial wedge is recruitment screening + interview scheduling, while the platform architecture remains use-case agnostic.

**ADR process:** architectural decisions are recorded as numbered ADRs and are never edited once accepted. Changing an accepted decision requires a superseding ADR, not an edit.

## First Claude implementation task

The architecture is approved. Phase 1 may begin on founder instruction.

First task:

> Implement the platform foundation: project structure, authentication, organizations, **organization memberships, invitations**, users, roles/permissions, tenant isolation **including row-level security policies**, **provider interface definitions**, database migrations, APIs, tests, and local development setup.

Do not implement agents, RAG, voice, recruitment workflows, billing, or external provider integrations in the first task.

The exact Phase 1 boundary — including the explicit out-of-scope list and the definition of done — is in `12_ARCHITECTURE_DECISIONS_FINAL.md`.
