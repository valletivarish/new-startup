# Database and API Specification v0.2

## Status

Implementation baseline. Updated 2026-08-16 to incorporate ADR-002, ADR-003, ADR-004, and ADR-005.

This document defines the data/API contract. Exact field types, indexes, constraints, pagination formats, and endpoint schemas are finalized during implementation.

**Authoritative companions:** `12_ARCHITECTURE_DECISIONS_FINAL.md` and `11_PERMISSION_MATRIX.md`.

## 1. Core entities

### Organization

Purpose: tenancy and commercial boundary.

Core fields:

- id
- name
- slug
- status
- created_at
- updated_at

### User

Global identity. **Not organization-owned.** A user may belong to many organizations (ADR-005).

Core fields:

- id
- name
- email (globally unique, case-insensitive)
- email_verified_at
- status
- created_at
- updated_at

> `organization_id` was removed from this entity on 2026-08-16 per ADR-005. The user-to-organization relationship is carried by `OrganizationMembership`, and the role lives on the membership.

### OrganizationMembership

The tenancy and role relationship. Organization-owned; carries RLS.

Core fields:

- id
- user_id
- organization_id
- role_id
- status (active | suspended)
- invited_by_user_id
- joined_at
- created_at
- updated_at

Constraint: `UNIQUE (user_id, organization_id)`.

### OrganizationInvitation

Allows inviting by email before an account exists.

Core fields:

- id
- organization_id
- email
- role_id
- token_hash
- invited_by_user_id
- expires_at
- accepted_at
- status

Constraint: unique pending invitation per (organization_id, email).

### Session

Server-side session record (ADR-002). Opaque token; not JWT.

Core fields:

- id
- user_id
- active_organization_id
- expires_at
- ip
- user_agent
- created_at

`active_organization_id` is set server-side and re-validated against an active membership on every request.

### Role

Core fields:

- id
- organization_id — **nullable**. `NULL` denotes a system role available to every organization; a non-null value denotes a future organization-defined custom role.
- name
- description

The seven system roles are Owner, Administrator, Agent Manager, Knowledge Manager, Recruiter/Operator, Analyst, Viewer. Custom roles are deferred past MVP.

### Permission

Core fields:

- id
- key (`resource.action`, e.g. `candidates.read_pii`)
- resource
- action
- description

Seeded by migration. The complete catalogue is defined in `11_PERMISSION_MATRIX.md`.

### RolePermission

Core fields:

- role_id
- permission_id

### Agent

Core fields:

- id
- organization_id
- name
- type
- status
- current_version_id
- created_at
- updated_at

### AgentVersion

Core fields:

- id
- agent_id
- version
- configuration
- status
- created_at

### KnowledgeSource

Core fields:

- id
- organization_id
- agent_id where applicable
- type
- name
- status
- created_at
- updated_at

### KnowledgeDocument

Core fields:

- id
- knowledge_source_id
- filename
- content_type
- storage_reference
- status
- version
- created_at

### KnowledgeChunk

Core fields:

- id
- document_id
- content
- embedding
- metadata

### Job

Core fields:

- id
- organization_id
- title
- description
- requirements
- status
- created_at
- updated_at

### Candidate

Core fields:

- id
- organization_id
- job_id
- name
- contact information
- status
- metadata
- created_at
- updated_at

Sensitive fields must receive appropriate protection and access controls.

### Conversation

Core fields:

- id
- organization_id
- agent_id
- candidate_id where applicable
- status
- channel
- started_at
- ended_at

### Message

Core fields:

- id
- conversation_id
- role
- content
- metadata
- created_at

### Call

Core fields:

- id
- organization_id
- conversation_id
- provider
- external_call_id
- direction
- status
- duration
- recording_reference where applicable
- created_at
- ended_at

### Evaluation

Core fields:

- id
- organization_id
- candidate_id
- conversation_id
- criteria_results
- overall_result
- confidence/metadata where appropriate
- created_at

### Workflow

Core fields:

- id
- organization_id
- agent_id
- name
- definition
- status

### WorkflowRun

Core fields:

- id
- workflow_id
- organization_id
- status
- current_step
- started_at
- completed_at

### Action

Core fields:

- id
- organization_id
- workflow_run_id
- tool_type
- input
- output
- status
- idempotency_key
- created_at

### Integration

Core fields:

- id
- organization_id
- type
- provider
- status
- credential_reference
- metadata

Do not store provider secrets as ordinary plaintext database values.

### UsageEvent

Core fields:

- id
- organization_id
- agent_id
- conversation_id/call_id where applicable
- service_type
- provider
- quantity
- unit
- timestamp
- metadata

### CostEvent

Core fields:

- id
- organization_id
- usage_event_id
- provider
- cost_amount
- currency
- calculation_metadata
- created_at

### AuditEvent

Core fields:

- id
- organization_id
- actor_user_id where applicable
- event_type
- resource_type
- resource_id
- metadata
- created_at

## 2. Tenant rules

**Engineering rule: no cross-tenant data access, even accidentally.**

Three layers, all required (ADR-003):

1. **Authorization** — does this membership hold the required permission?
2. **Explicit filtering** — every organization-owned query filters on `organization_id`.
3. **PostgreSQL row-level security** — the database refuses anything else.

Mechanism:

- Every organization-owned table carries `organization_id UUID NOT NULL`.
- Every such table sets `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`, declared in the same migration that creates the table.
- Policy: `USING (organization_id = current_setting('app.current_org_id', true)::uuid)` with a matching `WITH CHECK` clause.
- The application connects as a **non-owner database role** with no `BYPASSRLS`. Migrations run as a separate privileged role.
- A request-scoped transaction wrapper issues `SET LOCAL app.current_org_id` at the start of every transaction.

> **`app.current_org_id` is derived exclusively from the authenticated server-side session and is never read from a header, query parameter, or request body.**

- Transaction-mode connection pooling only. Session-level `SET` is forbidden — a pooled connection carrying a stale variable serves the wrong tenant.
- Background jobs establish tenant context per organization and per transaction, never once per batch.
- Global tables exempt from RLS, enumerated exhaustively: `users`, `organizations`, system `roles`, `permissions`, `role_permissions`, `sessions`.

Failure mode by design: a forgotten filter returns **zero rows**, not another tenant's data.

## 3. Authentication

Decided in ADR-002. This is no longer an open implementation decision.

**Mechanism:** a self-hosted authentication library (Better Auth) backed by our own PostgreSQL instance, issuing **opaque server-side session tokens** delivered in `httpOnly; Secure; SameSite=Lax` cookies. **Not JWT** — permissions are per-membership and mutable, and revocation must be immediate.

The authentication/authorization boundary is a hard architectural rule:

| Authentication library | Our authorization layer |
|---|---|
| Who are you? | Which organization? |
| Are you logged in? | Which membership? |
| Which session? | Which role? |
| Email verified? | Which permissions? |
| | May you perform THIS action? |

The library's own organization and role features are **not** used as the authorization mechanism.

Each authenticated request establishes:

- user identity
- active organization, re-validated against an active membership
- the permission set for that membership

Sessions are invalidated immediately on user deactivation, membership removal, and role change.

**Machine-to-machine surfaces do not use user sessions.** Provider webhooks authenticate by HMAC signature verification; future customer API access uses hashed, scoped, revocable API keys bound to an organization.

Every protected endpoint must enforce authorization.

## 4. API conventions

Use consistent:

- HTTP methods
- status codes
- error format
- pagination
- filtering
- sorting
- request IDs
- validation errors

## 5. Suggested endpoint groups

### Auth

- POST /auth/register
- POST /auth/login
- POST /auth/logout
- GET /auth/me
- POST /auth/verify-email
- POST /auth/forgot-password
- POST /auth/reset-password
- GET /auth/organizations — organizations the caller belongs to, with their role in each
- POST /auth/switch-organization — set active organization; re-validates membership and re-derives tenant context

Authentication mechanism is decided in §3 above and ADR-002.

### Organizations

- POST /organizations — create; the creator becomes Owner
- GET /organization
- PATCH /organization
- DELETE /organization — Owner only

### Memberships and invitations

- GET /organization/members
- PATCH /organization/members/{id} — change role or status
- DELETE /organization/members/{id} — remove membership
- GET /organization/invitations
- POST /organization/invitations — invite by email with an assigned role
- DELETE /organization/invitations/{id} — revoke
- POST /invitations/{token}/accept — public route; accepts and creates the membership

> `POST /organization/users` from v0.1 is replaced by `POST /organization/invitations`. Users are global identities and are never created directly inside an organization.

### Roles and permissions

- GET /roles
- GET /permissions

### Audit

- GET /audit

### Agents

- GET /agents
- POST /agents
- GET /agents/{id}
- PATCH /agents/{id}
- DELETE /agents/{id}
- POST /agents/{id}/versions
- POST /agents/{id}/test
- POST /agents/{id}/deploy

### Knowledge

- GET /knowledge
- POST /knowledge/sources
- POST /knowledge/documents
- GET /knowledge/documents/{id}
- DELETE /knowledge/documents/{id}
- POST /knowledge/reindex

### Jobs

- GET /jobs
- POST /jobs
- GET /jobs/{id}
- PATCH /jobs/{id}

### Candidates

- GET /candidates
- POST /candidates
- GET /candidates/{id}
- PATCH /candidates/{id}
- POST /candidates/{id}/screen

### Conversations

- GET /conversations
- GET /conversations/{id}
- GET /conversations/{id}/messages

### Calls

- GET /calls
- GET /calls/{id}

### Evaluations

- GET /candidates/{id}/evaluation
- POST /candidates/{id}/evaluation

### Workflows

- GET /workflows
- POST /workflows
- PATCH /workflows/{id}
- POST /workflows/{id}/run

### Integrations

- GET /integrations
- POST /integrations
- DELETE /integrations/{id}

### Usage

- GET /usage
- GET /usage/summary

### Costs

- GET /costs
- GET /costs/summary

### Analytics

- GET /analytics/overview
- GET /analytics/recruitment

## 6. Webhooks

Provider webhook endpoints should be isolated by provider/category and must validate signatures/authentication.

Webhook handlers must be idempotent.

## 7. Error format

Use a consistent machine-readable error structure containing at least:

- code
- message
- request_id
- field errors where applicable

Do not expose provider secrets or internal stack traces.

## 8. API security

Requirements:

- Authorization on every protected resource
- Organization scoping, plus the RLS backstop in §2
- Input validation at every boundary
- Rate limiting, keyed on organization as well as user
- Secure webhook validation
- Audit logging for sensitive actions

Additional rules from ADR-004:

- **Every non-public route declares its required permission.** A route with no declaration fails closed, verified by an automated route-coverage test.
- Authorization checks reference **permission strings**, never role names.
- Personal data is separately gated: `candidates.read_pii`, `calls.read_transcript`, `calls.read_recording`, and `candidates.export`. Responses to callers lacking these permissions **omit the fields entirely** rather than relying on the UI to hide them.
- Every permission denial and every sensitive read writes an `AuditEvent`.
- Agent tool authorization resolves through the same permission layer as human authorization.

## 9. Idempotency

Support idempotency keys for operations where duplicates could create business harm, including:

- Scheduling
- External updates
- Workflow actions
- Payment-related operations
- Provider webhooks
