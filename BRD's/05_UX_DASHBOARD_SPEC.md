# UX and Dashboard Specification v0.1

## 1. UX objective

The platform should feel like a business application, not an AI infrastructure console.

Users should be able to configure agents without understanding:

- LLM providers
- STT providers
- TTS providers
- Telephony APIs
- Vector databases

## 2. Main navigation

Initial:

- **Organization switcher** (persistent, top of navigation)
- Dashboard
- Agents
- Knowledge
- Jobs
- Candidates
- Calls
- Integrations
- Analytics
- Usage
- Users
- Billing
- Settings

Navigation must respect user permissions.

The **organization switcher** is required because a user may belong to several organizations with a different role in each (ADR-005). Switching re-derives permissions and invalidates cached data; the current organization must always be unambiguous on screen.

> Permission gating in the navigation is a **usability feature only**. All authorization is enforced server-side.

## 3. Login

Requirements:

- Secure authentication
- Clear errors
- Organization context
- Session management

Post-login routing:

- A user with several memberships lands in their last active organization.
- A user with exactly one membership lands there directly.
- A user with **no** memberships sees an empty state offering "create an organization" or a pending invitation to accept.

## 4. Organization setup

Onboarding has two distinct entry paths.

### Path A — create a new organization

The creator becomes Owner.

1. Organization name
2. Business information
3. Invite users
4. Create first agent
5. Add knowledge
6. Configure first workflow
7. Test
8. Deploy

### Path B — accept an invitation

The user joins an existing organization with the role assigned by the inviter. They land in that organization with permission-appropriate navigation. No setup wizard.

## 5. Dashboard

Show business-oriented information.

Recruitment MVP examples:

- Candidates screened
- Calls completed
- Qualified candidates
- Interviews scheduled
- Pending follow-ups
- Agent activity
- Usage
- Estimated cost

Avoid filling the main dashboard with raw token/provider metrics.

## 6. Agent list

Each agent card should show:

- Agent name
- Purpose
- Status
- Version
- Recent activity
- Usage
- Health/status

Actions:

- Open
- Edit
- Test
- Deploy
- Pause

## 7. Agent creation wizard

### Step 1 — Purpose

"What should this agent do?"

### Step 2 — Knowledge

"What should it know?"

### Step 3 — Conversation

"What should it ask and how should it behave?"

### Step 4 — Rules

"What qualifies as success?"

### Step 5 — Actions

"What can it do?"

### Step 6 — Fallback

"What should happen if it cannot answer or complete an action?"

### Step 7 — Capabilities

- Voice quality
- Intelligence level
- Languages
- Calling capacity

Do not expose provider names by default.

### Step 8 — Test

Run sample conversations.

### Step 9 — Deploy

Show deployment confirmation and limits.

## 8. Knowledge UI

Users should be able to:

- Upload files
- Add sources
- See processing status
- View source status
- Remove sources
- Reindex where appropriate
- Associate knowledge with agents

Show whether knowledge is:

- Processing
- Ready
- Failed
- Outdated

## 9. Recruitment UI

### Jobs

Show:

- Job title
- Status
- Candidate count
- Screened count
- Qualified count
- Interview count

### Candidate

Show:

- Candidate information
- Job
- Status
- Conversation history
- Evaluation
- Follow-ups
- Interview information

## 10. Candidate evaluation UI

Show structured results rather than raw model output.

Example:

Experience — Qualified
Skills — Qualified
Location — Qualified
Notice period — Qualified
Salary — Within range
Overall — Recommended

Always make clear that AI evaluation supports human decision-making.

Candidate contact details render only for members holding `candidates.read_pii`. For everyone else the API **omits those fields entirely** — the UI does not hide data it received. The same applies to transcripts and recordings, gated by `calls.read_transcript` and `calls.read_recording`.

## 11. Calls

Show:

- Date/time
- Agent
- Candidate
- Status
- Duration
- Outcome
- Transcript where permitted

## 12. Analytics

Recruitment dashboard:

- Candidates contacted
- Calls completed
- Screening completion
- Qualification rate
- Interview scheduling rate
- Follow-up rate
- Average call duration
- Estimated cost

## 13. Usage

Show:

- Agent usage
- Calls/minutes
- Included usage
- Remaining usage
- Limits
- Alerts

Provider-level details may be available to administrators but should not dominate the user experience.

## 14. Billing

Organization-level.

Show:

- Current plan
- Agents included
- Usage allowance
- Current usage
- Estimated charges
- Subscription status

Exact pricing is not yet finalized.

## 15. Users

This screen manages **memberships and invitations**, not global user records. A user is a global identity; what an organization controls is that user's membership in it.

Active members — show:

- Name
- Email
- Role **in this organization**
- Status
- Last activity

Pending invitations — show:

- Email
- Assigned role
- Invited by
- Expiry
- Resend / revoke

Administrators can invite, change roles, and deactivate memberships where permitted.

Guardrails that must be visible in the UI, not only enforced server-side:

- The last Owner cannot be removed or demoted.
- Only an Owner can grant or revoke the Owner role.
- An Administrator cannot modify an Owner's membership.
- No one can change their own role.

## 16. Integrations

Use business terminology:

- Calendar
- ATS
- CRM
- Email
- Messaging

Avoid making provider selection the main experience.

## 17. Settings

Sections:

- Organization
- Users/roles
- Agent defaults
- Security
- Data retention
- Notifications
- Integrations
- Billing

## 18. UX principles

1. Business-first terminology.
2. Hide infrastructure complexity.
3. Make dangerous actions explicit.
4. Show meaningful defaults.
5. Provide guided setup.
6. Make agent state visible.
7. Show costs without overwhelming users.
8. Keep permissions clear.
9. Design for desktop first but keep layouts responsive.
10. Do not make users edit raw prompts unless advanced mode is intentionally enabled.
11. **Permission gating in the UI is a usability feature only. All authorization is enforced server-side.**
12. **Make the active organization unambiguous at all times.** A user acting in the wrong organization is a data-handling incident, not a minor confusion.

## 19. Accessibility

The dashboard should support:

- Keyboard navigation
- Clear labels
- Appropriate contrast
- Screen-reader-friendly controls
- Clear error messages
- Responsive layouts

## 20. Future UX

Potential future capabilities:

- White-label branding
- Custom domains
- Agent marketplace/templates
- Advanced workflow builder
- A/B testing
- Agent evaluation suites
- Advanced provider/cost controls
