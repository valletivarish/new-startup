# Product Strategy v0.1

## 1. Product

A multi-tenant, provider-independent AI agent platform for business workflows.

The platform allows organizations to create, configure, deploy, monitor, and optimize AI agents.

## 2. Initial wedge

Recruitment screening + interview scheduling.

The recruitment agent should:

1. Understand a job description.
2. Use approved company/job knowledge.
3. Contact candidates.
4. Conduct screening conversations.
5. Ask predefined and dynamic follow-up questions.
6. Collect structured candidate information.
7. Evaluate candidates against configured criteria.
8. Schedule interviews.
9. Perform follow-ups.
10. Provide recruiters with structured results.

## 3. Why recruitment first

Recruitment exercises most of the reusable platform:

- Voice
- STT
- TTS
- LLM
- RAG
- Memory
- Rules
- Structured outputs
- Candidate data
- Calendar integration
- Follow-up
- Analytics
- Cost tracking
- Organization permissions

## 4. Long-term use cases

Potential future agents:

- Sales
- Customer support
- Recruitment
- Promotions
- Appointment booking
- Healthcare administration
- Operations
- Financial workflows
- Follow-ups

These are roadmap capabilities, not MVP commitments.

## 5. Product principles

### Provider independence
No permanent dependency on one AI/telephony provider.

### Capability abstraction
Customers configure business capabilities, not provider names.

### Organization-first
Organizations are the primary tenancy and commercial boundary.

### Knowledge-first
Agents need access to organization-approved knowledge.

### Action-oriented
Agents should perform approved business actions.

### Use-case agnostic core
Recruitment, sales, support, and other agents use the same underlying platform.

### Cost awareness
Usage and provider costs must be measurable.

### Human control
Organizations control permissions, actions, escalation, deployment, and data.

### Progressive complexity
Simple UI for normal users; advanced controls when needed.

## 6. Positioning direction

Do not position the company as:

- Another generic AI voice API
- A cheaper clone of a specific competitor
- A wrapper around one LLM or voice provider

Positioning direction:

> A business AI-agent platform that lets organizations create knowledgeable, actionable AI agents without being locked into one AI infrastructure provider.

## 7. MVP success

The MVP should prove that a real organization can:

- Create an organization.
- Add users.
- Create an AI recruitment agent.
- Add company/job knowledge.
- Configure screening criteria.
- Test the agent.
- Contact candidates.
- Conduct screening.
- Generate structured evaluation.
- Schedule an interview.
- View usage and costs.
- Manage permissions.
- Operate without understanding the underlying providers.
