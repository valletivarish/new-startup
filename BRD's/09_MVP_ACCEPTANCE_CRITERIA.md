# MVP Acceptance Criteria

## Organization

- Organization can be created; the creator becomes Owner.
- Organization data is isolated.
- Users can be invited by email, whether or not they already have an account.
- An invited user can accept an invitation and receive the assigned role.
- Roles can be assigned per membership.
- **A user can belong to multiple organizations and hold a different role in each.**
- **Switching organizations changes visible data and effective permissions, with no leakage between them.**
- The last Owner of an organization cannot be removed or demoted.
- Unauthorized users cannot access restricted resources.

## Agent

- Organization can create an agent.
- Agent has versioned configuration.
- Agent can be tested.
- Agent can be deployed/paused.
- Agent configuration is not provider-specific.

## Knowledge

- Organization can upload supported documents.
- Documents are processed.
- Knowledge is indexed.
- Agent can retrieve relevant knowledge.
- Knowledge retrieval is tenant-scoped.
- Failed retrieval does not cause hallucinated company facts by default.

## Recruitment

- Recruiter can create a job.
- Recruiter can add candidates.
- Recruiter can initiate screening.
- Agent can conduct configured screening.
- Agent can ask follow-up questions where appropriate.
- Evaluation is structured.
- Recruiter can view evaluation.

## Voice

- Outbound screening call can be initiated.
- Call status is tracked.
- Speech is transcribed where supported.
- Agent can respond through TTS.
- Call completion is recorded.
- Provider failures are handled gracefully.

## Scheduling

- Qualified candidate can be offered scheduling.
- Calendar integration can create an interview.
- Duplicate scheduling is prevented.

## Follow-up

- No-answer state can trigger configured follow-up.
- Candidate-requested callback can be scheduled.
- Human escalation can be triggered.

## Usage

- Calls/minutes are tracked.
- LLM/STT/TTS usage is tracked where available.
- Cost events are stored.
- Usage limits can stop or restrict expensive workflows.

## Security

- Cross-tenant access tests pass, against real PostgreSQL.
- **Row-level security is enabled and forced on every organization-owned table**, verified by an automated schema-drift test.
- **A query executed with no tenant context returns zero rows** — isolation fails closed.
- Organization A cannot read, modify, or insert rows attributed to Organization B.
- Role permissions are enforced server-side, checked as permission strings rather than role names.
- **Every non-public route declares a required permission**, verified by an automated route-coverage test.
- **An Analyst cannot retrieve candidate contact details, transcripts, or recordings through any API path** — the fields are absent from the response, not merely hidden in the UI.
- Sensitive reads and permission denials write audit events.
- Session invalidation is immediate on deactivation, membership removal, and role change.
- Secrets are not committed.
- Sensitive data is not unnecessarily logged.
- Webhooks are authenticated and idempotent.

## UX

- Non-technical user can create an agent using the guided flow.
- Provider names are not required for normal agent configuration.
- Dashboard displays meaningful business outcomes.
- Errors are understandable.

## Quality

- Core automated tests pass.
- Critical integration paths have tests.
- No known critical tenant-isolation issue.
- No known critical secret exposure.
- No uncontrolled outbound-call loop.
- No uncontrolled LLM/tool loop.

## Business validation

The MVP is not commercially validated until a real organization completes a real workflow and provides feedback.

Technical completion is not the same as product-market validation.
