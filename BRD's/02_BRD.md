# Business Requirements Document (BRD) v0.1

## 1. Executive summary

The product is a multi-tenant AI agent platform that enables organizations to create, configure, deploy, monitor, and optimize customized AI agents for business workflows.

The first commercial wedge is AI-powered recruitment screening and interview scheduling in India.

## 2. Business objectives

1. Reduce repetitive business communication workload.
2. Allow non-technical organizations to create useful AI agents.
3. Give agents access to organization-specific knowledge.
4. Enable agents to perform approved business actions.
5. Avoid permanent provider lock-in.
6. Give organizations visibility into usage and cost.
7. Establish a reusable platform for multiple business workflows.
8. Maintain a bootstrap-friendly operating model.

## 3. Target customers

Initial ICP:

> Indian startups and mid-market organizations with recurring or high-volume hiring requirements.

Long term:

- Startups
- SMBs
- Mid-market
- Enterprises
- Agencies/MSPs
- Sales teams
- Support teams
- Recruitment teams
- Appointment-based organizations

## 4. Organization model

Organizations are the commercial and tenancy boundary.

**A user may belong to multiple organizations and may hold a different role in each.** Organization membership, not the user record, carries the role (ADR-005). This is what allows agencies, MSPs, consultancies, partner organizations, and multi-entity founders to use the platform with one account.

Organizations can:

- Manage users.
- Assign roles.
- Create agents.
- Manage knowledge.
- Configure integrations.
- View usage.
- View analytics.
- Manage billing.

## 5. User roles

Initial roles:

- Owner
- Administrator
- Agent Manager
- Knowledge Manager
- Recruiter/Operator
- Analyst
- Viewer

Exact permissions are defined in **`11_PERMISSION_MATRIX.md`** — 51 permissions across 15 resource groups, bundled into these seven system roles. Roles are held per membership, so the same person may be an Owner in one organization and a Viewer in another.

## 6. Agent requirements

An agent can contain:

- Purpose
- Identity/personality
- Instructions
- Knowledge
- Questions
- Qualification criteria
- Rules
- Guardrails
- Voice
- Language
- Tools
- Actions
- Escalation
- Follow-up
- Evaluation configuration

## 7. Knowledge requirements

Organizations should be able to provide:

- Documents
- PDFs
- FAQs
- Website content
- Policies
- Job descriptions
- Structured Q&A
- Company information

Knowledge must be organization-scoped and access-controlled.

Agents should not invent organization-specific information when reliable approved knowledge is unavailable.

## 8. Recruitment requirements

The recruitment agent shall support:

- Job configuration
- Candidate management
- Screening questions
- Qualification criteria
- Disqualification criteria
- Company/job knowledge
- Voice/language configuration
- Follow-up
- Escalation
- Candidate evaluation
- Interview scheduling

## 9. Candidate workflow

Candidate added
→ Contact
→ Conversation
→ Screening
→ Dynamic follow-up
→ Structured evaluation
→ Qualified/not qualified/human review
→ Interview/follow-up/close

## 10. Business actions

Potential actions:

- Calendar booking
- ATS update
- CRM update
- Email
- SMS/WhatsApp where supported
- API call
- Ticket creation
- Callback scheduling
- Human transfer

Every action must be permission-controlled.

## 11. Provider abstraction

The platform must abstract:

- Telephony
- STT
- TTS
- LLM
- Embeddings
- Vector storage
- Calendar
- ATS/CRM
- Notifications

Customer-facing UI should expose business capabilities rather than provider names.

## 12. Usage and cost

Track usage by:

- Organization
- Agent
- Call
- Duration
- STT
- TTS
- LLM
- Knowledge operations
- Actions

Provide cost visibility and usage limits.

## 13. Dashboard

Initial navigation:

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

## 14. Security

Required principles:

- Tenant isolation
- Authentication
- Authorization
- Role-based access
- Secure provider credentials
- Encryption in transit
- Audit logging
- Controlled access to candidate information
- Controlled access to recordings/transcripts
- Data retention controls

Enforcement, per the approved ADRs:

- **Tenant isolation is enforced at both the application layer and the database layer** (PostgreSQL row-level security). Engineering rule: no cross-tenant data access, even accidentally.
- **Access to candidate contact information, transcripts, and recordings is controlled by distinct permissions** — `candidates.read_pii`, `calls.read_transcript`, `calls.read_recording`, `candidates.export` — separate from ordinary read access. Responses omit these fields entirely for callers who lack the permission.
- Every such read, and every permission denial, writes an audit event.

## 15. MVP scope

Included:

- Organization management
- Authentication
- User roles
- Agent creation
- Recruitment agent
- Knowledge management
- RAG
- Screening questions
- Candidate management
- Voice screening
- Structured evaluation
- Basic follow-up
- Interview scheduling
- Basic integration
- Usage tracking
- Cost tracking
- Basic analytics
- Provider abstraction

Deferred:

- Large integration marketplace
- Full white-label
- Custom domains
- Enterprise SSO
- Advanced autonomous multi-agent systems
- Global telephony
- Custom model training
- Dedicated GPU infrastructure
- Every possible language
- Every business use case
- Advanced provider optimization

## 16. Acceptance principle

The MVP is successful when a real organization can create and operate a useful recruitment agent without needing to understand the underlying AI infrastructure.
