# Permission Matrix v0.1

**Status:** ACCEPTED — approved by founder, 2026-08-16
**Date:** 2026-08-16
**Governed by:** `10_ADRs/ADR-004-permission-model.md`
**Fills the gap left by:** `02_BRD.md` §5 — "Exact permissions must be defined in the API/authorization specification"

---

## How to read this

- Permissions are strings of the form `resource.action`. **Application code checks permissions, never role names.**
- Roles are named bundles of permissions, seeded by migration as **system roles** (`roles.organization_id IS NULL`), available to every organization.
- A permission is held **per membership**, not per user. The same person may be an Owner in one organization and a Viewer in another (`ADR-005`).
- This layer answers *"may this member perform this action?"*. PostgreSQL row-level security separately answers *"whose rows are these?"* (`ADR-003`). **Both must pass.**
- ✅ = granted · `·` = denied

### Roles

| Code | Role | Intent |
|---|---|---|
| **OWN** | Owner | Ultimate authority. Billing, organization deletion, ownership transfer. |
| **ADM** | Administrator | Full operational control; cannot delete the organization or change billing. |
| **AGM** | Agent Manager | Builds, tests, deploys agents and workflows. Sees conversations to tune quality. |
| **KNM** | Knowledge Manager | Owns the knowledge base. No candidate or call access at all. |
| **REC** | Recruiter / Operator | Day-to-day hiring work. The only non-admin role with candidate PII access. |
| **ANL** | Analyst | Read-only analysis. Deliberately excluded from PII, transcripts, and recordings. |
| **VWR** | Viewer | Minimal read access to business outcomes. No personal data of any kind. |

---

## The matrix

| Permission | OWN | ADM | AGM | KNM | REC | ANL | VWR |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Organization settings** | | | | | | | |
| `organization.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `organization.update` | ✅ | ✅ | · | · | · | · | · |
| `organization.delete` | ✅ | · | · | · | · | · | · |
| **Users** | | | | | | | |
| `users.read` | ✅ | ✅ | ✅ | · | ✅ | ✅ | · |
| `users.invite` | ✅ | ✅ | · | · | · | · | · |
| `users.update` | ✅ | ✅ | · | · | · | · | · |
| `users.deactivate` | ✅ | ✅ | · | · | · | · | · |
| **Roles** | | | | | | | |
| `roles.read` | ✅ | ✅ | ✅ | · | · | · | · |
| `roles.assign` | ✅ | ✅ | · | · | · | · | · |
| `roles.manage` *(custom roles — post-MVP)* | ✅ | · | · | · | · | · | · |
| **Agents** | | | | | | | |
| `agents.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `agents.create` | ✅ | ✅ | ✅ | · | · | · | · |
| `agents.update` | ✅ | ✅ | ✅ | · | · | · | · |
| `agents.delete` | ✅ | ✅ | ✅ | · | · | · | · |
| `agents.test` | ✅ | ✅ | ✅ | · | · | · | · |
| **Agent deployment** | | | | | | | |
| `agents.deploy` | ✅ | ✅ | ✅ | · | · | · | · |
| `agents.pause` | ✅ | ✅ | ✅ | · | ✅ | · | · |
| **Knowledge** | | | | | | | |
| `knowledge.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · |
| `knowledge.create` | ✅ | ✅ | · | ✅ | · | · | · |
| `knowledge.update` | ✅ | ✅ | · | ✅ | · | · | · |
| `knowledge.delete` | ✅ | ✅ | · | ✅ | · | · | · |
| `knowledge.reindex` | ✅ | ✅ | ✅ | ✅ | · | · | · |
| **Jobs** | | | | | | | |
| `jobs.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `jobs.create` | ✅ | ✅ | · | · | ✅ | · | · |
| `jobs.update` | ✅ | ✅ | · | · | ✅ | · | · |
| `jobs.delete` | ✅ | ✅ | · | · | · | · | · |
| **Candidates** | | | | | | | |
| `candidates.read` *(no contact details)* | ✅ | ✅ | ✅ | · | ✅ | ✅ | · |
| `candidates.read_pii` *(phone, email, résumé)* | ✅ | ✅ | · | · | ✅ | · | · |
| `candidates.create` | ✅ | ✅ | · | · | ✅ | · | · |
| `candidates.update` | ✅ | ✅ | · | · | ✅ | · | · |
| `candidates.delete` | ✅ | ✅ | · | · | · | · | · |
| `candidates.export` | ✅ | ✅ | · | · | ✅ | · | · |
| **Calls** | | | | | | | |
| `calls.read` *(metadata only)* | ✅ | ✅ | ✅ | · | ✅ | ✅ | ✅ |
| `calls.read_transcript` | ✅ | ✅ | ✅ | · | ✅ | · | · |
| `calls.read_recording` | ✅ | ✅ | ✅ | · | ✅ | · | · |
| `calls.initiate` | ✅ | ✅ | · | · | ✅ | · | · |
| **Workflows** | | | | | | | |
| `workflows.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `workflows.create` | ✅ | ✅ | ✅ | · | · | · | · |
| `workflows.update` | ✅ | ✅ | ✅ | · | · | · | · |
| `workflows.delete` | ✅ | ✅ | ✅ | · | · | · | · |
| `workflows.run` | ✅ | ✅ | ✅ | · | ✅ | · | · |
| **Integrations** | | | | | | | |
| `integrations.read` | ✅ | ✅ | ✅ | · | ✅ | · | · |
| `integrations.create` | ✅ | ✅ | · | · | · | · | · |
| `integrations.update` | ✅ | ✅ | · | · | · | · | · |
| `integrations.delete` | ✅ | ✅ | · | · | · | · | · |
| **Analytics** | | | | | | | |
| `analytics.read` | ✅ | ✅ | ✅ | · | ✅ | ✅ | ✅ |
| **Usage** | | | | | | | |
| `usage.read` | ✅ | ✅ | ✅ | · | ✅ | ✅ | · |
| `usage.manage_limits` | ✅ | ✅ | · | · | · | · | · |
| **Billing** | | | | | | | |
| `billing.read` | ✅ | ✅ | · | · | · | · | · |
| `billing.manage` | ✅ | · | · | · | · | · | · |
| **Audit logs** | | | | | | | |
| `audit.read` | ✅ | ✅ | · | · | · | · | · |

**Total: 51 permissions across 15 resource groups.**

---

## Design notes — why the non-obvious calls were made

### Deployment is separate from editing
`agents.deploy` is not bundled into `agents.update`. Editing a draft agent is free; deploying one puts it in front of real candidates and starts spending money on telephony, STT, TTS, and LLM calls. These deserve separate authorization, and the split makes a "can edit, cannot ship" role possible later without redesign.

### `agents.pause` is granted to Recruiters
Pausing is a *safety* action, not a privileged one. The operator watching a screening call go wrong should be able to stop it without finding an administrator. Granting the brake more widely than the accelerator is deliberate.

### Candidate PII is split from candidate records
`02_BRD.md` §14 requires "controlled access to candidate information". `candidates.read` exposes status, evaluation results, and funnel position; `candidates.read_pii` exposes phone number, email, and résumé. This is what lets an Analyst study qualification rates without ever seeing a candidate's phone number — and it is far cheaper to design now than to retrofit once code assumes candidate reads are all-or-nothing.

### Transcripts and recordings are separate from call metadata
Same requirement, same reasoning. A transcript contains everything the candidate said about salary, notice period, and personal circumstances — it is PII regardless of how it is stored. Analysts and Viewers get duration, status, and outcome; they do not get the conversation.

### Agent Managers can read transcripts but not candidate PII
This looks inconsistent and is intentional. Tuning agent quality is impossible without hearing how conversations actually go, so `calls.read_transcript` and `calls.read_recording` are granted. Bulk contact-detail access is a different capability and is not needed for that job. Flag for founder review — this is the assignment most likely to need adjustment against how the team actually works.

### Knowledge Managers are fully walled off from candidates
They curate company and job knowledge. They have no business need for candidate data, so they have no access to it. Least privilege applied literally.

### Administrators can read billing but not change it
`billing.manage` — payment methods, plan changes, cancellation — is Owner-only. Administrators can see spend, which they need for operational decisions.

### Analysts cannot export
`candidates.export` is withheld from Analysts because a CSV export is the easiest path to bulk PII leaving the system. Analysts work through aggregated `analytics.read` endpoints, which are designed to return no personal data.

---

## Structural invariants

These are enforced in code and covered by tests. They are not expressible in the matrix above.

1. Every organization must have **at least one active Owner** at all times. The last Owner cannot be demoted, removed, or deactivated.
2. **Only an Owner may grant or revoke the Owner role.**
3. An Administrator **cannot modify an Owner's membership** — not their role, not their status.
4. **No member may escalate their own permissions**, including by self-assigning a higher role.
5. Role changes and membership removal **invalidate affected sessions immediately** (`ADR-002`).
6. Permissions resolve against the session's **active organization membership** only — never globally, never from client-supplied context.
7. Every **permission-denied** event, and every **sensitive read** (`candidates.read_pii`, `calls.read_transcript`, `calls.read_recording`, `candidates.export`), writes an `AuditEvent`.
8. Every non-public API route **declares a required permission**. Routes with no declaration fail closed, verified by an automated route-coverage test.
9. **AI agent tools resolve through this same permission layer.** An agent cannot perform an action the initiating membership lacks permission for. This satisfies `07_CODING_RULES_FOR_CLAUDE.md` §12 — prompts are not a security boundary.

---

## Tools and permissions (Phase 4)

Phase 4 introduced **no new permissions**. The catalogue remains at 54. A tool
does not get a permission of its own; it *declares* one from this matrix, and
the runtime checks that declaration against the acting membership before the
tool runs.

| Built-in tool | Declares | Effect |
|---|---|---|
| `calculator` | `agents.test` | Available to Owner, Administrator, Agent Manager |
| `test_echo` | `agents.test` | Same |
| `test_structured_output` | `agents.test` | Same |
| `deterministic_business_action` | `workflows.run` | Available to Owner, Administrator, Agent Manager, Recruiter |

Managing the catalogue is agent configuration, so it reuses the agent
permissions rather than inventing tool-specific ones:

| Operation | Permission |
|---|---|
| List the catalogue, list an agent's tools | `agents.read` |
| Install built-ins, enable/disable a tool, grant/revoke to an agent | `agents.update` |
| Read tool execution records | `agents.sessions.read` |

**Five independent conditions** must all hold before a tool executes. None of
them is derivable from anything the model produces:

1. the tool exists in the caller's organization (RLS-scoped);
2. a registered implementation exists for that name;
3. the tool is enabled;
4. the tool is granted to this agent;
5. the acting membership holds the tool's declared permission.

A model requesting a tool is a *suggestion*. Authorization is decided by
`authorizeTool`, which takes no argument the model can influence — there is
deliberately no field for the tool's arguments, because what a tool is allowed
to do must not depend on what it was asked to do.

---

## Required tests

- Each role can perform exactly its granted permissions and no others — table-driven across all 51 × 7 combinations.
- Cross-tenant: a member of Organization A holding a permission cannot exercise it against Organization B's resources.
- Privilege escalation: self-role-change is rejected; Administrator cannot alter an Owner; the last Owner cannot be removed.
- Session invalidation on role change and on membership removal.
- Route coverage: no non-public route lacks a declared permission.
- PII boundary: an Analyst session receives candidate records with contact fields absent — **not merely hidden in the UI**.

---

## Deliberately out of scope for MVP

- **Custom organization-defined roles.** The schema supports them (`roles.organization_id`); the feature is deferred.
- **Record-level scoping** — "only candidates for jobs assigned to me". The extension point is defined in `ADR-004`; no implementation now.
- **Per-field redaction policies** beyond the PII splits above.
- **Time-bound or just-in-time elevated access.**
