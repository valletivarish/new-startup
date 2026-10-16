# 00. Current system map: product and frontend side

Date: 2026-10-03. Scope: what the product does today, where data enters and leaves it, and what the existing docs already decided or deferred about ATS/CRM, webhooks, MCP and integrations. This is the baseline for the integration work ("connect your system once, data flows in, the agent works, results flow back").

How to read the labels:
- **FACT**: verified in the repo. A file path (and line numbers where useful) follows every one. Paths are relative to the repo root `/Users/valletivarish/Documents/new startup/`.
- **RECOMMENDATION**: my suggestion for the integration design, not a decision anyone has made.
- **ASSUMPTION**: a belief I could not verify from the repo.
- **unverified**: I looked and could not confirm it.

No web research was needed for this document. It describes the current system only. Vendor and protocol research belongs in the later documents in this folder.

---

## 1. Summary

1. **FACT.** HRVoice (hiring) is the only live use case. Support, sales and appointments are "later" (`apps/web/PRODUCT.md:40-41`, `apps/web/PRODUCT.md:52`).
2. **FACT.** Candidates get into the product in three ways, all of them manual and all inside one job: a form for one person (with an optional resume file or pasted resume text), a CSV file or pasted CSV rows, and the phone number read from a resume (`apps/web/components/candidates/add-candidates.tsx`, `apps/web/lib/api.ts:1025-1050`, `apps/web/lib/api.ts:1300-1320`).
3. **FACT.** Call results (summary, structured answers, transcript, recording) can only be read in the app. Nothing in the UI exports or pushes them anywhere. The only download in the app is the audit log CSV under Settings > Activity (`apps/web/components/settings/activity.tsx:198-230`). `exportCandidate()` exists in the API client but no screen calls it (`apps/web/lib/api.ts:1339-1342`; grep of `apps/web/app` and `apps/web/components` finds no caller).
4. **FACT.** The product has no integrations of any kind today: no Integrations screen, no `integrations` table, no customer webhooks, no customer API keys, no MCP server. The Tools page shows "Your own systems: Later. Sending results to the HR software you already use, and other connections. Not built yet." (`apps/web/app/tools/page.tsx:106-119`). The website says ATS integration is "Not yet" (`apps/web/components/site/faq.tsx:53-55`).
5. **FACT.** The docs already set the seams for this work. `CRMProvider` and `CalendarProvider` are defined as interfaces with no implementation (`packages/providers/src/interfaces.ts:230-253`). Customer webhooks and MCP are "not day-one" and should subscribe to the domain events `call.started | call.ended | result.ready | transfer.requested` (`docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md:12`, `:71-72`, `:82`). Machine-to-machine access is to use "hashed, scoped, revocable API keys bound to an organization" (`BRD's/04_DATABASE_API_SPEC.md:410`, `BRD's/10_ADRs/ADR-002-authentication.md:96`). `integrations.*` permissions are already seeded (`packages/db/drizzle/0002_seed_permission_matrix.sql:63-66`).
6. **FACT.** The product never recommends hire or reject, and never scores or ranks people. A person on the customer's team moves each candidate to one of three decisions (`apps/web/PRODUCT.md:56`, `apps/api-java/src/main/resources/usecases/hiring.json` `result.summaryInstruction` and `result.adviceGuard`). Older docs still carry "Qualified / Recommended" and "fit %" / "alignment %" ideas. Section 9 lists these conflicts because they matter for what we may write back into a customer's ATS.

---

## 2. Users and jobs-to-be-done

| # | Label | Statement | Source |
|---|---|---|---|
| U1 | FACT | Primary app users are "recruiters and hiring owners at Indian SMBs who need to phone-screen many applicants for open roles. Early on, the same person is also the workspace admin." They work on a laptop and check results on a phone. | `apps/web/PRODUCT.md:11` |
| U2 | FACT | Website buyers are "founders, HR heads and operations leads evaluating whether a voice agent can take real business calls for them." | `apps/web/PRODUCT.md:12` |
| U3 | FACT | Candidates "receive an ordinary phone call. They never see the product." There is no candidate login and no apply portal. | `apps/web/PRODUCT.md:13`, `docs/superpowers/specs/2026-09-17-hiring-po-research-pack.md:15`, `:49` |
| U4 | FACT | Jobs-to-be-done: the recruiter wants to "Screen candidates by phone without juggling scripts manually". The admin (often the same person) wants to "Create company, invite teammates later". | `docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md:22-28` |
| U5 | FACT | The recruiter loop is: create job, paste or upload the description (PDF, DOCX, PPTX), set must-ask questions, add candidates (one at a time, CSV, or resume PDF/DOCX with the phone extracted), try a browser test call, call by phone, review, move the candidate forward. | `apps/web/PRODUCT.md:34` |
| U6 | FACT | Success is defined as: "a recruiter goes from job description to reviewed screens without learning anything about models, speech providers or telephony." | `apps/web/PRODUCT.md:23` |
| U7 | FACT | The target customer is "Indian startups and mid-market organizations with recurring or high-volume hiring requirements." | `BRD's/02_BRD.md:22-24` |
| U8 | FACT | Seven system roles exist (Owner, Administrator, Agent Manager, Knowledge Manager, Recruiter/Operator, Analyst, Viewer), and custom roles are live. Administrators can create and edit roles up to their own power. | `BRD's/11_PERMISSION_MATRIX.md:20-30`, `BRD's/10_ADRs/ADR-009-administrators-manage-custom-roles.md:14-23` |
| U9 | ASSUMPTION | Most first customers already keep candidates in a spreadsheet, an Indian job board (Naukri etc.) or a lightweight ATS. The website chatbot recognises "naukri, zoho, workday, greenhouse, excel" as ATS questions (`apps/web/components/site/chat.tsx:298-321`), which suggests the team expects those names. Which systems customers really use is not recorded anywhere in the repo. |  |

---

## 3. App map (routes)

**FACT.** The sidebar is built in `apps/web/components/layout/app-shell/nav.ts` (`buildNav`). Nav items are hidden when the person lacks the permission. That is cosmetic only: the server enforces access (`BRD's/05_UX_DASHBOARD_SPEC.md:37`).

| Route | Nav label | Permission to see it | What it is | Source |
|---|---|---|---|---|
| `/` | (website) | public | Marketing site: hero, how it works, sample call, use cases, pricing, FAQ | `apps/web/app/page.tsx`, `apps/web/components/site/*` |
| `/login` | n/a | public | Sign in, create account, forgot password. "Company name" on register creates the workspace at once. | `apps/web/app/login/page.tsx:4-5`, `:109`, `:149` |
| `/invitations/accept` | n/a | public with token | Accept a team invite, with or without an existing account | `apps/web/app/invitations/accept/page.tsx`, `apps/web/lib/api.ts:290-323` |
| `/reset-password` | n/a | public with token | Password reset | `apps/web/app/reset-password/page.tsx` |
| `/dashboard` | Home | none | First-run checklist until setup is done ("Set up your agent", ...), then the queues Ready for review / Didn't connect / Not called / On hold | `apps/web/components/home/first-run.tsx`, `apps/web/components/home/queues.tsx:404-538`, `apps/web/lib/api.ts:964-990` |
| `/jobs` | Jobs | `jobs.read` | Job list; create a job (title only) | `apps/web/app/jobs/page.tsx` |
| `/jobs/[id]` | (Jobs) | `jobs.read` | Job setup: job description (paste or file, with AI assist "generate / format / questions"), must-ask questions, AI hiring agent, Open for calls; English or Hindi | `apps/web/app/jobs/[id]/page.tsx:503-529`, `:639-640`, `:790-791`, `:978-1012`, `:328-344`, `:98` |
| `/jobs/[id]/candidates` | (Jobs) | `jobs.read` | The job's candidates board: filters, search, bulk decisions, candidate sheet, Add/Upload CSV | `apps/web/app/jobs/[id]/candidates/page.tsx` |
| `/candidates` | Candidates | `candidates.read` | Everyone on open jobs in one list, filter by state and job; opens the person on their job | `apps/web/app/candidates/page.tsx:1-7`, `:39-46`, `apps/web/lib/hiring-people.ts` |
| `/calls` | Calls | `agents.sessions.read` | Every phone and browser test call, newest first; live calls on top with End call; `?candidateId=` shows one person's call history | `apps/web/app/calls/page.tsx:1-7`, `:51-60` |
| `/agents`, `/agents/new`, `/agents/[id]` | Agents | `agents.read` | The AI hiring agent: name, purpose, hand-off numbers, publish/pause, intelligence tier, voice test, setup text (JSON), test sessions | `apps/web/app/agents/new/page.tsx:37-40`, `:260-315`, `apps/web/app/agents/[id]/page.tsx` |
| `/knowledge` | Knowledge | `knowledge.read` | Company documents (file or pasted text), status, search "what a call would find", document sets | `apps/web/app/knowledge/page.tsx:1-7`, `:472-516` |
| `/tools` | Tools | `agents.read` | "What the agent can do": static list (section 7) | `apps/web/app/tools/page.tsx` |
| `/analytics` | Analytics | `analytics.read` | This month / last month counts from real calls and candidates; nothing estimated | `apps/web/app/analytics/page.tsx:1-8`, `:183-184` |
| `/settings` | Settings | none (tabs gated) | Workspace, Team, Access levels, Activity, Your account (section 6) | `apps/web/app/settings/page.tsx:90-95` |
| `/design-system` | n/a | n/a | Internal component showcase | `apps/web/app/design-system/page.tsx` |

**FACT.** The UI words for nouns come from a use-case definition, not hard-coded hiring words: `useUseCase().labels.workItem` (Job/Jobs) and `labels.contact` (Candidate/Candidates). There is a bundled HRVoice definition, and `GET /use-cases` can refine its words (`apps/web/lib/use-cases.ts`, `apps/web/lib/use-case-definitions.ts:34-45`, `docs/superpowers/specs/2026-10-01-strip-board-redesign-design.md` section 9).

---

## 4. Where data enters

### 4.1 Account, workspace, team

| Label | What | Source |
|---|---|---|
| FACT | Sign-up takes name, email, password and company name, then calls `ensureOrganization` so the company exists straight away. | `apps/web/app/login/page.tsx:41`, `:109-117`, `apps/web/lib/api.ts:126-127`, `:192-197` |
| FACT | Team invites go by email with a role and produce a copyable link (72 hours). Resend rotates the link. | `apps/web/components/TeamSettings.tsx:215-217`, `apps/web/lib/api.ts:256-323` |
| FACT | Custom roles: create/edit/delete with a permission picker. | `apps/web/lib/api.ts:325-381`, `apps/web/components/settings/access-levels.tsx` |

### 4.2 Jobs (the work item)

| Label | What | Source |
|---|---|---|
| FACT | A job is created with a title only. Description, must-ask questions, agent, language (`en`/`hi`) and status (`draft`/`open`/`closed`) are set later on the job's Setup page. | `apps/web/app/jobs/page.tsx:252-262`, `apps/web/lib/api.ts:865-891` |
| FACT | The job description is pasted text or an uploaded file (PDF, DOCX, PPTX, TXT, MD). It is saved as job knowledge and indexed for the call. | `apps/web/app/jobs/[id]/page.tsx:503-529`, `apps/web/lib/api.ts:893-925`, `apps/web/lib/upload.ts` (`ACCEPT_DOCUMENT`) |
| FACT | "JD assist" can generate or format a description and suggest questions from notes. | `apps/web/lib/api.ts:902-916`, `apps/web/app/jobs/[id]/page.tsx:328-344` |
| FACT | Rule: "HR configures JD once on the Job. Opening that Job, upload candidates, Call: never re-select JD/Job/Agent." | `docs/ARCHITECTURE.md:11-12` |
| FACT | Job fields in the web contract: `id, title, description, status, agentId, screeningQuestions[{id,label}], screeningLanguage, createdAt, updatedAt, hasJdDocs`. No external or ATS id field exists. | `apps/web/lib/api.ts:786-798`; no `external_id` on `jobs` or `candidates` in `packages/db/drizzle/*.sql` (grep: the only `external_*` columns are on voice tables in `0013_elevenlabs_foundation.sql`) |
| FACT | External job boards (LinkedIn, Naukri, career site) are out of V1: "HR posts elsewhere; our app starts at Job create + intake." | `docs/ARCHITECTURE.md:26` |

### 4.3 Candidates (the contact)

All candidate entry points are under one job. Candidates are job-scoped, and one phone number can appear only once per job.

| Label | Entry point | Details | Source |
|---|---|---|---|
| FACT | **Add one person** (dialog "Add a candidate") | Full name (required), mobile (needed unless the resume has one), resume file (PDF, Word, PowerPoint or text) or pasted resume text. The server pulls the phone from the resume when the mobile is empty (`phoneFromResume`). | `apps/web/components/candidates/add-candidates.tsx:33-138`, `apps/web/lib/api.ts:1300-1320` |
| FACT | **Upload CSV** (dialog "Upload a CSV") | A `.csv` file or pasted rows, first row is the header. Columns: full name, country code, phone, optional email; "Columns named Name, Mobile or Dial code work too." The server previews and returns per-row issues (`missing_full_name, missing_country_code, missing_phone, invalid_phone, invalid_email, duplicate_in_batch, duplicate_on_job`). Rows are fixed in place, "Use +91 where the code is missing" fills the code, then confirm adds the ready rows. | `apps/web/components/candidates/add-candidates.tsx:196-366`, `apps/web/lib/api.ts:1005-1050` |
| FACT | **CSV template** | `public/templates/candidates.csv` with header `full_name,phone,email`. | `apps/web/public/templates/candidates.csv` |
| FACT | **Formats not accepted** | No XLSX and no ZIP of resumes. The file input accepts `.csv,text/csv,text/plain` only. A resume is one file per person. | `apps/web/components/candidates/add-candidates.tsx:318`, `:132-133` |
| FACT | **Edit** | Name, phone, email and resume text can be edited in the candidate sheet (Details tab). | `apps/web/lib/api.ts:1322-1334`, `apps/web/components/candidates/CandidateDetailSheet.tsx:254-256` |
| FACT | **Source label** | The sheet shows "From a resume", "From a CSV" or "Added by hand". The DB only allows `source IN ('manual','resume')`, and the CSV import inserts `'manual'`, so CSV rows show "Added by hand". | `apps/web/components/candidates/CandidateDetailSheet.tsx:86-92`, `packages/db/drizzle/0015_hiring_desk_foundation.sql:20`, `apps/api-java/src/main/java/desk/hiring/Candidates.java:147-166` |
| FACT | **Candidate fields** in the web contract | `id, jobId, fullName, source, screeningStatus, countryCode, phone, email, resumeText, createdAt, updatedAt`. Phone, email and resume are PII and are only returned to holders of `candidates.read_pii`. | `apps/web/lib/api.ts:811-823`, `BRD's/11_PERMISSION_MATRIX.md:72-73` |
| FACT | **Earlier intent** | The V1 freeze promised "manual + intelligent bulk (CSV/XLSX/ZIP resumes/paste) → normalize to candidate JSON". Only CSV/paste and single resumes shipped. | `docs/ARCHITECTURE.md:27` |
| FACT | **Website position** | "Not yet. Add candidates from a spreadsheet saved as CSV or from their resumes. Your team reviews each call and moves candidates forward in HRVoice." | `apps/web/components/site/faq.tsx:53-55`, `apps/web/components/site/chat.tsx:298-321` |

### 4.4 Agent and knowledge

| Label | What | Source |
|---|---|---|
| FACT | Agent setup takes a name, "What should it do on a call?" and optional hand-off (transfer) phone numbers. No job description or questions on the agent. | `apps/web/app/agents/new/page.tsx:1-5`, `:260-290`, `docs/ARCHITECTURE.md:10` |
| FACT | Agent detail also edits the intelligence tier, the raw setup JSON ("Setup text") and the tool grants. | `apps/web/app/agents/[id]/page.tsx:659-760` |
| FACT | Knowledge takes files (PDF, DOCX, PPTX, TXT, MD) or pasted text, grouped into optional document sets. No website/URL crawling. | `apps/web/app/knowledge/page.tsx:472-516`, `apps/web/lib/upload.ts` |

### 4.5 Data the system creates

| Label | What | Source |
|---|---|---|
| FACT | Every call (phone or browser) is a `VoiceSession`: `status (pending/active/ended/failed)`, `transcript [{role, message, timeInCallSecs}]`, `summary`, `structuredAnswers` (key/value), `durationSeconds`, `costCredits`, `startedAt/endedAt`, `jobId`, `candidateId`, `agentId`, `channel`, and `failureReason` (`no_answer, busy, voicemail, line_not_connected, invalid_number, carrier_blocked, network, unknown`). | `apps/web/lib/api.ts:669-703` |
| FACT | Per candidate on a job, `getJobCandidateResults` returns the latest result plus every call newest first (`sessions[]`), each with `recordingAvailable` and `fitPercent`. | `apps/web/lib/api.ts:842-859`, `:1115-1119` |
| FACT | Stage changes are recorded with who, when and an optional reason (`stage-history`). | `apps/web/lib/api.ts:1097-1113` |
| FACT | Audit events cover job, candidate, call, agent and knowledge changes, plus sensitive reads ("Opened records"). | `apps/web/components/settings/activity.tsx:24-60` |

---

## 5. Where data leaves (results views and exports)

| Label | Surface | What it shows | Source |
|---|---|---|---|
| FACT | **Candidate sheet > Results** (default tab) | Every call newest first. For each: **Summary**, then **Answers** (the job's must-ask questions in order, unanswered ones shown as missing, then "extras"), then **Transcript** with the **Recording** player. Then "Ask about this call" with presets "Summarize this call", "Draft follow-up questions", "What was unclear?". | `apps/web/components/candidates/ScreeningSessionCard.tsx:19-112`, `apps/web/components/candidates/answers.ts`, `apps/web/components/candidates/ReviewPanel.tsx:19-22`, `:299-303` |
| FACT | **Permission gating of results** | Without `calls.read_transcript`, the person sees only that a call happened ("You can see that a call happened"). Recording needs `calls.read_recording`. The API leaves the fields out; the UI does not just hide them. | `apps/web/components/candidates/ReviewPanel.tsx:210-211`, `apps/web/components/candidates/CandidateDetailSheet.tsx:270-271`, `BRD's/02_BRD.md:216` |
| FACT | **Calls page** | Same evidence per call, plus live calls, filters by status (All, Live now, Ended, Didn't connect) and channel (Phone, Browser). | `apps/web/app/calls/page.tsx:1-7`, `:51-60` |
| FACT | **Home and Candidates list** | Queues and state tags only (Ready for review, Didn't connect, Not called yet, On hold, Moved forward, Not moving forward). | `apps/web/app/candidates/page.tsx:39-46`, `apps/web/lib/api.ts:977-988` |
| FACT | **Analytics** | Counts from the workspace's own calls and candidates: how calls ended, stages, test calls. No personal data. | `apps/web/app/analytics/page.tsx:1-8`, `:432-558` |
| FACT | **Recording** | Streamed from an authenticated URL into the in-page player. There is no download button. | `apps/web/lib/api.ts:1207-1209`, `apps/web/components/shared/recording-player.tsx` (grep: no "download") |
| FACT | **Audit CSV** (Settings > Activity) | "Download" of the activity log or of stage moves, for a date range, up to the server's export limit. This is the only file download in the app. | `apps/web/components/settings/activity.tsx:198-230`, `apps/web/lib/api.ts:1253-1277` |
| FACT | **Single-candidate JSON export** | `GET /candidates/{id}/export` exists in the client and in the Java API (`candidates.export`, audited), but no screen uses it. | `apps/web/lib/api.ts:1339-1342`, `apps/api-java/src/main/java/desk/hiring/HiringController.java:451-457` |
| FACT | **No results export** | There is no CSV/XLSX export of candidates with their answers or summaries, no copy button on results, and no push to another system. | grep of `apps/web/app` and `apps/web/components` for `export`, `download`, `clipboard` (only invite links use `CopyField`: `apps/web/components/TeamSettings.tsx`) |

**RECOMMENDATION.** Treat "how does a recruiter get results into their own sheet or ATS today?" as an open pain. Today the answer is retyping or copy-pasting from the sheet. That supports the founder's goal. A results CSV export (gated by `candidates.export`) is the cheapest stopgap, and it would also define the field list that any ATS write-back needs.

---

## 6. Settings

**FACT.** Tabs, each shown only when permitted (`apps/web/app/settings/page.tsx:90-95`):

| Tab | Permission | Contents | Source |
|---|---|---|---|
| Workspace | an active workspace | **Workspace name** (rename needs `organization.update`). **Calling number**: one of three states "Not connected yet", "Verification pending" or "Ready to call", from `GET /telephony/status`, with "Try a test call". | `apps/web/components/settings/sections.tsx:123-131`, `:238-318` |
| Team | `users.read` or `users.invite` | People, invites (copyable 72-hour links), role changes, removal, password reset email | `apps/web/components/TeamSettings.tsx` |
| Access levels | `roles.read` | System and custom roles, permission editor. The groups **Workflows, Integrations and Billing are hidden** "Areas of the product that aren't built yet stay out of the editor". | `apps/web/components/settings/access.ts:108-109`, `apps/web/components/settings/access-levels.tsx` |
| Activity | `audit.read` | Audit log as sentences, filters (Changes, Stage moves, Opened records), CSV download | `apps/web/components/settings/activity.tsx` |
| Your account | always | Name, password | `apps/web/components/settings/sections.tsx:363-440` |

**FACT.** Settings has **no Integrations, Billing, Notifications, Data retention or API keys section**. The BRD asked for "Organization, Users/roles, Agent defaults, Security, Data retention, Notifications, Integrations, Billing" (`BRD's/05_UX_DASHBOARD_SPEC.md:310-321`), and the redesign proposal put "integrations" in Settings (`docs/superpowers/specs/2026-09-17-ai-voice-agent-ux-redesign-proposal.md:184`, `:330`).

**RECOMMENDATION.** An integration's connection screen belongs as a new Settings tab ("Connected systems" or similar, with plain words per `docs/superpowers/specs/2026-10-02-app-consistency.md` section 8), gated by `integrations.read` and `integrations.create`. When it ships, unhide the Integrations group in `apps/web/components/settings/access.ts:109`.

---

## 7. Tools page and the tool catalogue

### 7.1 The Tools page ("What the agent can do")

**FACT.** It is a static page with no API calls except the profile (`apps/web/app/tools/page.tsx:29-40`). Header: "All of this is built in and works on every call. Connecting your own systems comes later." (`:85`). Cards (`:47-77`, `:106-119`):

| Card | Text (abridged) | Link |
|---|---|---|
| Calls your candidates | Phones each candidate you add to a job, or takes a test call in your browser | Open jobs |
| Asks your questions | Asks each job's must-ask questions and answers from the job description and company facts | Open knowledge |
| Hands the call to a person | Transfers to someone on your team when a candidate asks for a person | Set hand-off numbers |
| Notices voicemail | Marks the call as reached voicemail | none |
| Writes it all down | Recording, transcript, summary and each answer. "It never recommends who to hire." | Open calls |
| **Your own systems** (dashed, "Later") | "Sending results to the HR software you already use, and other connections. Not built yet." | none |

**FACT.** These cards match the `actions` block of the hiring use-case definition: `endCall: true, voicemailDetection: true, transferToHuman: true, followUp: false, webhook: false` (`apps/api-java/src/main/resources/usecases/hiring.json`, key `actions`). The `webhook: false` flag is the definition-level switch that integration work would turn on.

### 7.2 The agent tool catalogue (separate from the Tools page)

| Label | Statement | Source |
|---|---|---|
| FACT | A tool has `name, description, inputSchema, outputSchema, requiredPermission, enabled, version`. Tools are installed per workspace, enabled or disabled, and granted per agent. Executions are logged per session. | `apps/web/lib/api.ts:602-655` |
| FACT | Built-in tools are developer test tools: `calculator`, `test_echo`, `test_structured_output` (declare `agents.test`) and `deterministic_business_action` (declares `workflows.run`). | `BRD's/11_PERMISSION_MATRIX.md:153-165` |
| FACT | Five conditions must all hold before a tool runs: the tool exists in the org (RLS), an implementation is registered, it is enabled, it is granted to the agent, and the acting member holds its declared permission. The model's request is "a suggestion". | `BRD's/11_PERMISSION_MATRIX.md:176-188`, `BRD's/03_SYSTEM_ARCHITECTURE.md:316-332` |
| FACT | On the agent page this catalogue is labelled **"Integrations"** ("Company integrations this agent may use during a call. Most teams leave these off.") and tool runs are labelled **"Integration calls"**. | `apps/web/app/agents/[id]/page.tsx:700-735`, `:859` |
| RECOMMENDATION | The word "Integrations" is already in use on the agent page for test tools. Rename that group (for example "Extra abilities") before shipping real ATS/CRM connections, or the two will be confused. Decide whether in-call ATS lookups become catalogue tools, with the five-condition check and a declared permission, or stay out of the call entirely. |  |

---

## 8. Candidate stage model and the decision rule

### 8.1 Stages (decisions)

**FACT.** The stage values in the API and DB are `new | screening | reviewed | declined` (`apps/web/lib/api.ts:809`, `packages/db/drizzle/0018_job_scoped_candidates.sql:19-23`, `packages/db/drizzle/0026_candidate_declined_stage.sql`). The UI words do not match the raw values (`apps/web/lib/status-labels.ts:57-64`):

| Raw value | UI label | Meaning | Closing? |
|---|---|---|---|
| `new` | No decision yet | undecided | no |
| `screening` | On hold | a person paused them | no |
| `reviewed` | Moved forward | a person chose to advance them | yes |
| `declined` | Not moving forward | a person chose not to advance them | yes |

Sources for "closing": `apps/web/lib/use-case-definitions.ts:42-44`.

**FACT.** Only a person changes a stage: per candidate in the sheet's decision footer, or in bulk (Move forward, Put on hold, Not moving forward, Clear decision) with an optional reason and Undo. Changes need `jobs.update` (`apps/web/app/jobs/[id]/candidates/page.tsx:1174-1230`, `apps/web/components/candidates/decisions.ts`, `apps/web/lib/api.ts:1061-1095`).

**FACT.** The backend's hiring definition labels `new` as "Not called yet". The web overrides it to "No decision yet" because "Not called yet" is a call state (`apps/api-java/src/main/resources/usecases/hiring.json` `stages`, `apps/web/lib/use-case-definitions.ts:52-56`).

### 8.2 Call states (separate from the decision)

**FACT.** Call state is derived from the latest call: `not_called` (Not called yet), calling, `active` (On call), `transferring` (Handing to your team), `results_pending` (Writing up the call), `ready_for_review` (Ready for review: the call ended and the stage is still `new` or `screening`), ended (Call ended), and the failure reasons (No answer, Line busy, Reached voicemail, Calling number not set up, Number not valid, Call didn't connect) (`apps/web/lib/status-labels.ts:66-90`, `:159-180`).

### 8.3 The "never recommend hire or reject" rule

| Label | Statement | Source |
|---|---|---|
| FACT | "The product never recommends hire or reject. It reports what was said." | `apps/web/PRODUCT.md:56` |
| FACT | "Evidence before judgement: summary first, transcript and recording one click away, the human decides." | `apps/web/PRODUCT.md:69` |
| FACT | Words to use: "Ready for review, Moved forward, Not moving forward". Words never used: "shortlisted, rejected, hire, score, fit". | `docs/superpowers/specs/2026-10-02-app-consistency.md:98` |
| FACT | The summary prompt: "Do not recommend hiring or rejecting, do not score, rank or judge fit." An `adviceGuard` refuses chat questions matching `hire, reject, should we, recommend, good fit, bad fit, select, shortlist, pass on`. | `apps/api-java/src/main/resources/usecases/hiring.json` keys `result.summaryInstruction`, `result.adviceGuard` |
| FACT | The engine applies the advice guard after extraction, and use-case definitions carry an "evaluation rubric (reported, never advice)". | `BRD's/10_ADRs/ADR-008-java-spring-ai-backend.md:44`, `docs/superpowers/specs/2026-10-01-java-spring-ai-backend-design.md:75` |
| FACT | Analytics must not give "who to take" recommendations. | `docs/superpowers/specs/2026-09-16-voice-agent-platform-design.md:138` |
| RECOMMENDATION | For ATS/CRM write-back: write only facts (call status and outcome, timestamps, duration, summary, answers to the customer's own questions, transcript or recording links if the customer allows) and the stage **a person** chose. Never write a score, rank, fit %, "qualified", or a stage change the system decided by itself. A stage moved in our app should map to the customer's own stage only through a mapping the customer configures, and every move must trace back to a named person (`stage-history` already records the actor). |  |
| RECOMMENDATION | Do not send `fitPercent` to any external system (see conflict C2 in section 9). |  |

---

## 9. Conflicts and stale statements in the docs

These matter because an integration designer reading only the BRD would build the wrong thing.

| # | Label | Conflict | Sources |
|---|---|---|---|
| C1 | FACT | The early BRD/UX docs describe AI evaluation verdicts: workflow step "Qualified/not qualified/human review", an evaluation UI with "Overall: Recommended", the events `candidate_qualified`, and an `Evaluation.overall_result` field. The later product docs forbid this. The later docs (PRODUCT.md, the 2026-10 specs, hiring.json) are what the product follows. | `BRD's/02_BRD.md:122-131`, `BRD's/05_UX_DASHBOARD_SPEC.md:199-212`, `BRD's/03_SYSTEM_ARCHITECTURE.md:363-364`, `BRD's/04_DATABASE_API_SPEC.md:253-264` vs `apps/web/PRODUCT.md:56` |
| C2 | FACT | **Fit / alignment %.** The V1 freeze says "Alignment % only. Default weights 40/25/20/10/5." The launch spec defines "fit % = share of must-ask answers collected (null when no criteria)". The API still returns `fitPercent`, and the hiring definition's `review.coverageMessage` prints a "Must-ask coverage ... %" line (and its `noCoverageMessage` says "to see a score"). The web **does not render** `fitPercent` anywhere, and the words rulebook bans "score, fit". | `docs/ARCHITECTURE.md:17`, `docs/superpowers/specs/2026-09-17-hiring-po-research-pack.md:22`, `:56`, `docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md:105`, `apps/web/lib/api.ts:854`, `apps/api-java/src/main/resources/usecases/hiring.json` key `review`, `docs/superpowers/specs/2026-10-02-app-consistency.md:98`; grep of `apps/web/app`, `apps/web/components` for `fitPercent` finds no use |
| C3 | FACT | The BRD wedge is "Recruitment screening + interview scheduling", and the MVP criteria include "Calendar integration can create an interview". Nothing schedules interviews today (`followUp: false`, no calendar code, scheduled callbacks out of V1). | `BRD's/00_PROJECT_CONTEXT.md:9`, `BRD's/09_MVP_ACCEPTANCE_CRITERIA.md:51-55`, `apps/api-java/src/main/resources/usecases/hiring.json` `actions`, `docs/superpowers/specs/2026-09-17-hiring-po-research-pack.md:50-51` |
| C4 | FACT | The permission count is "51" in the matrix and the final architecture doc, but "54" in the matrix's Phase 4 section (later additions such as `agents.sessions.*`). | `BRD's/11_PERMISSION_MATRIX.md:105`, `:155`, `BRD's/12_ARCHITECTURE_DECISIONS_FINAL.md` section A8 |
| C5 | FACT | The 12_ doc says the backend is NestJS/TypeScript. ADR-008 (PROPOSED, not yet accepted) moves the backend to Java/Spring, and the Java API now serves the web app. New integration backend work goes in `apps/api-java`. | `BRD's/12_ARCHITECTURE_DECISIONS_FINAL.md` section A3, `BRD's/10_ADRs/ADR-008-java-spring-ai-backend.md:3`, `apps/api-java/MIGRATION_STATUS.md:89-91` |
| C6 | FACT | The redesign specs ask for a bulk "Call now" in the candidates bulk bar. The shipped bulk bar has decisions only. | `docs/superpowers/specs/2026-10-01-saas-redesign-design.md:202` vs `apps/web/app/jobs/[id]/candidates/page.tsx:1174-1230` |
| C7 | FACT | The V1 freeze promised XLSX and ZIP-of-resumes intake. Only CSV/paste and single resumes shipped (section 4.3). | `docs/ARCHITECTURE.md:27` |
| C8 | FACT | Retention: the V1 freeze says "90 days; Admin-only early delete". The final architecture doc lists data retention as an open item "before first customer". I found no retention setting in the web app. | `docs/ARCHITECTURE.md:24`, `BRD's/12_ARCHITECTURE_DECISIONS_FINAL.md` section D3; grep of `apps/web` for retention finds no UI |

---

## 10. What the docs already decided or deferred about integrations

### 10.1 Decided (binding unless superseded)

| # | Label | Decision | Source |
|---|---|---|---|
| D1 | FACT | **Calendar and CRM/ATS are provider-independent layers behind adapters.** "Do not hard-code business logic to a provider SDK." | `BRD's/00_PROJECT_CONTEXT.md:63-77`, `BRD's/02_BRD.md:149-163`, `BRD's/07_CODING_RULES_FOR_CLAUDE.md:80-93` |
| D2 | FACT | `CalendarProvider` (`createEvent` with a required `idempotencyKey`, `cancelEvent`) and `CRMProvider` (`upsertRecord({organizationId, recordType, externalId?, fields, idempotencyKey}) → {externalId}`) are defined as **TypeScript interfaces only**. "Defined" phase 1, "implemented" phase 6 (Recruitment). Adapters receive an already-validated tenant context and "must never resolve tenancy themselves." | `packages/providers/src/interfaces.ts:20-29`, `:230-253`, `BRD's/12_ARCHITECTURE_DECISIONS_FINAL.md` section A9 |
| D3 | FACT | Customer-facing language is business terms ("Calendar, ATS, CRM, Email, Messaging"). "Avoid making provider selection the main experience." | `BRD's/05_UX_DASHBOARD_SPEC.md:298-308` |
| D4 | FACT | Every action, including "ATS update" and "CRM update", must be permission-controlled. Agent tool authorization uses the same permission layer as people; "prompts are not a security boundary." | `BRD's/02_BRD.md:133-147`, `BRD's/11_PERMISSION_MATRIX.md:149` |
| D5 | FACT | Idempotency is required for "CRM/ATS updates", calendar booking, candidate status, webhooks and workflow actions: "Duplicate events must not create duplicate business outcomes." | `BRD's/03_SYSTEM_ARCHITECTURE.md:434-445`, `BRD's/04_DATABASE_API_SPEC.md:586-594` |
| D6 | FACT | **Inbound webhooks** (from providers) must verify authenticity, identify provider and organization, validate the payload, process idempotently, record the event and respond. They authenticate by HMAC, never by user session. The existing voice webhook verifies HMAC over raw bytes and resolves the org through a narrow RLS policy keyed on the conversation id. | `BRD's/03_SYSTEM_ARCHITECTURE.md:422-432`, `BRD's/12_ARCHITECTURE_DECISIONS_FINAL.md` section A5, `docs/superpowers/specs/2026-10-01-java-spring-ai-backend-design.md:48`, `packages/db/drizzle/0022_voice_webhook_lookup.sql` |
| D7 | FACT | **Customer API access** (future) uses "hashed, scoped, revocable API keys bound to an organization", never user sessions. | `BRD's/04_DATABASE_API_SPEC.md:410`, `BRD's/10_ADRs/ADR-002-authentication.md:22`, `:96` |
| D8 | FACT | An `Integration` entity is specified: `id, organization_id, type, provider, status, credential_reference, metadata`. "Do not store provider secrets as ordinary plaintext database values." The endpoints `GET/POST /integrations` and `DELETE /integrations/{id}` are suggested. **Not built**: no migration creates such a table. | `BRD's/04_DATABASE_API_SPEC.md:303-315`, `:529-533`; grep of `packages/db/drizzle/*.sql` |
| D9 | FACT | Permissions `integrations.read` (OWN, ADM, AGM, REC), and `integrations.create/update/delete` (OWN, ADM) are seeded. `candidates.export` is granted to OWN, ADM and REC, and withheld from Analysts because "a CSV export is the easiest path to bulk PII leaving the system". Every `candidates.export` read writes an audit event. | `BRD's/11_PERMISSION_MATRIX.md:77`, `:89-93`, `:132-133`, `:147`, `packages/db/drizzle/0002_seed_permission_matrix.sql:63-66`, `apps/api-java/src/main/java/desk/authz/Permissions.java:66-69` |
| D10 | FACT | **Domain events at the call/result boundary**: `call.started | call.ended | result.ready | transfer.requested`, payload "orgId + ids + pack id". "Webhooks/MCP subscribe to these; hiring UI reads DB." The Java engine emits them. | `docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md:81-82`, `docs/superpowers/specs/2026-10-01-java-spring-ai-backend-design.md:75` |
| D11 | FACT | **Stable domain nouns**: "Organization → Agent (typed by pack) → Knowledge → Contact → Job/Task → Call/Session → Result → Transfer target". Hiring maps Contact≈candidate, Job≈open role, Result≈screening packet. Avoid `candidate_*` names on shared call tables and `if (hiring)` branches. | `docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md:76-88` |
| D12 | FACT | The use-case definition declares "allowed post-call actions". Hiring today: `endCall, voicemailDetection, transferToHuman` true; `followUp, webhook` false. A new use case is a JSON definition, with no engine change. | `BRD's/10_ADRs/ADR-008-java-spring-ai-backend.md:44`, `docs/superpowers/specs/2026-10-01-java-spring-ai-backend-design.md:50-77`, `apps/api-java/src/main/resources/usecases/hiring.json` |
| D13 | FACT | Durable background work runs on our own `background_jobs` table (FOR UPDATE SKIP LOCKED, inside the tenant's context, exponential backoff, payload sealing). It is the obvious home for outbound sync jobs. Background jobs set tenant context "per organization, per transaction, never once per batch". | `docs/superpowers/specs/2026-10-01-java-spring-ai-backend-design.md:114-125`, `packages/db/drizzle/0030_background_jobs.sql`, `BRD's/03_SYSTEM_ARCHITECTURE.md:407` |
| D14 | FACT | "Shipping fake webhook/MCP UI" is an anti-pattern, and the website may show unbuilt work only "as clearly labelled later work". | `docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md:88`, `apps/web/PRODUCT.md:41` |
| D15 | FACT | Sensitive data stays gated: `candidates.read_pii`, `calls.read_transcript`, `calls.read_recording`, `candidates.export`. Responses omit fields for callers without them, and each such read is audited. | `BRD's/12_ARCHITECTURE_DECISIONS_FINAL.md` section A8, `BRD's/04_DATABASE_API_SPEC.md:582-583` |

### 10.2 Deferred (explicitly not day-one)

| # | Label | Deferred item | Source |
|---|---|---|---|
| F1 | FACT | "Customer webhooks; MCP connectors for embedding in third-party apps" are not day-one. MCP is to be "a façade later" over "stable org-scoped APIs + tool catalogue". | `docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md:12`, `:71-72`, `:140` |
| F2 | FACT | "Not built yet: ... customer webhooks, MCP/embedding, billing." | `apps/web/PRODUCT.md:41` |
| F3 | FACT | "Large integration marketplace" is deferred; the MVP includes only "Basic integration". | `BRD's/02_BRD.md:236`, `:244` |
| F4 | FACT | Phase 1 explicitly excluded "Integrations: calendar, ATS, CRM". They belong to phase 6 (Recruitment). | `BRD's/12_ARCHITECTURE_DECISIONS_FINAL.md` Phase 1 out-of-scope, phase table row 6 |
| F5 | FACT | External job boards are out of V1. | `docs/ARCHITECTURE.md:26` |
| F6 | FACT | Scheduled callbacks and auto-retry are out of V1; retry is HR-triggered only. | `docs/ARCHITECTURE.md:25`, `docs/superpowers/specs/2026-09-17-hiring-po-research-pack.md:51`, `:72` |
| F7 | FACT | Record-level scoping ("only candidates for jobs assigned to me") is deferred, with an extension point in ADR-004. | `BRD's/11_PERMISSION_MATRIX.md:206`, `BRD's/12_ARCHITECTURE_DECISIONS_FINAL.md` section C |
| F8 | FACT | A generic workflow engine is skipped "until proven need". The early docs do describe a Trigger → Condition → Agent interaction → Action workflow model, with `workflows.*` permissions seeded but hidden in the UI. | `docs/superpowers/specs/2026-09-16-voice-agent-platform-design.md:116-122`, `BRD's/03_SYSTEM_ARCHITECTURE.md:301-314`, `apps/web/components/settings/access.ts:109` |

### 10.3 Not decided anywhere (gaps)

| # | Label | Gap | Evidence |
|---|---|---|---|
| G1 | FACT | No doc names which ATS/CRM systems to support first, or how customers connect them (OAuth, API key, CSV drop, email parsing). | grep of `BRD's/`, `docs/` for named ATS vendors finds only design-inspiration links (`docs/superpowers/specs/2026-10-01-inspiration-notes.md:231-250`) and UX references (`docs/superpowers/specs/2026-09-17-ai-voice-agent-ux-redesign-proposal.md:86-87`) |
| G2 | FACT | No external-id columns exist on `jobs` or `candidates`, so an imported record cannot be linked back to its source system today. `CRMProvider.upsertRecord` assumes an `externalId`. | `packages/db/drizzle/0015_hiring_desk_foundation.sql:13-22`, `packages/providers/src/interfaces.ts:244-253` |
| G3 | FACT | `CRMProvider` covers write (upsert) only. There is no read, list, poll or subscribe method for pulling candidates or jobs **in**. | `packages/providers/src/interfaces.ts:244-253` |
| G4 | FACT | `CRMProvider` and `CalendarProvider` are TypeScript interfaces in `packages/providers`, which the Java backend does not use. The Java ports are `LlmPort, EmbeddingPort, VoiceAgentPort, TelephonyPort`. No CRM/ATS port exists in Java. | `BRD's/10_ADRs/ADR-008-java-spring-ai-backend.md:43`; grep of `apps/api-java/src` for `CRMProvider|CalendarProvider` finds nothing |
| G5 | FACT | No outbound webhook design (signing scheme, retries, delivery log, payload schema) and no customer API key design (scopes, rotation) exist beyond the one-line principles in D6 and D7. | sources in D6, D7 |
| G6 | FACT | The `candidates.source` column allows only `manual`/`resume`, so there is no way to mark "came from an ATS". | `packages/db/drizzle/0015_hiring_desk_foundation.sql:20` |
| G7 | FACT | No stage-mapping concept exists (our four stages vs a customer's pipeline stages). | section 8.1 |
| G8 | FACT | No in-app notifications or email to the recruiter when results are ready. The Home queues are the only signal. | `apps/web/lib/api.ts:977-990`, `BRD's/05_UX_DASHBOARD_SPEC.md:319` (listed, not built) |

---

## 11. UI conventions any integration screen must follow

All **FACT** from `docs/superpowers/specs/2026-10-02-app-consistency.md` unless noted:

- **Frame**: `AppShell` > `PageMain` > `PageHeader` with one `h1` and one serif-italic phrase in the h1 only (section 1). Settings h1: "Settings *for your workspace*". Tools h1: "What the agent *can do*".
- **Surfaces**: cards `rounded-card border border-border bg-canvas p-5 sm:p-6`. Role radii for buttons, inputs and tags. Sentence case, no all-caps, no em or en dashes (section 2).
- **Buttons**: `<Button>` only. One `primary` per view. Real phone calls and deletes confirm with `ConfirmDialog` (section 3).
- **Lists**: `ListRows` > `ListRow`. Counts are true totals. "Missing counts are left out, never 0." (section 4)
- **Status**: `StatusTag`/`StageTag`/`StatusBadge`, always an icon plus a word. "Raw API values never reach the screen; no new colours." (section 5)
- **States**: skeletons shaped like the result, `EmptyState`, and `ErrorState` via `toUserMessage`. "Every failure says what happened, then the next step." (section 6)
- **Words** (section 8): "workspace" not organization; "the people you allow" not roles/permissions; "calling number" not telephony; "Ready for review, Moved forward, Not moving forward" not "shortlisted, rejected, hire, score, fit"; no vendor names; contact and work-item words from `useUseCase().labels`; "Never fabricate a number, person or customer."
- **Done means** (section 10): no sideways scroll at 390px, 44px targets, full keyboard paths, 4.5:1 contrast, `motion-safe:`, typecheck and tests pass, headless screenshots at 1440 and 390.
- Also: no vendor names in UI (`apps/web/PRODUCT.md:54`), but a customer's **own** system name (for example their ATS brand) is a different case.
  - **RECOMMENDATION:** decide explicitly whether third-party ATS brand names may appear on a connection screen. The current rule targets our infrastructure vendors (speech, model, telephony). Showing the customer's own ATS name looks necessary for a "connect your ATS" screen, but no doc says so.
- The error filter in `apps/web/lib/errors.ts:77` hides messages containing words like "webhook", "api key", "token" and "payload". **FACT.** Integration error copy must be written in plain words, or the fallback text will replace it.

---

## 12. Implications for the integration design

All **RECOMMENDATION** unless marked.

1. **Unit of sync = job + candidate + call result.** These already exist as the stable nouns (D11). Inbound sync creates or updates jobs and candidates. Outbound sync sends `result.ready` facts and human stage decisions.
2. **Inbound must reuse the existing intake rules.** Job-scoped candidates, `(job_id, phone)` uniqueness, phone and country-code validation, `+91` defaulting, and the preview issue codes (`apps/web/lib/api.ts:1005-1012`). An ATS import is a CSV import without the file, so the existing preview/confirm logic should be the one validation path.
3. **Add provenance before anything else**: external system, external id and last-synced time on jobs and candidates, and a new `source` value (G2, G6). Without these, re-sync creates duplicates or overwrites edits.
4. **Outbound = subscribe to the existing domain events** (D10) through the durable `background_jobs` queue (D13), with idempotency keys (D5) and an audit trail. Writing PII or transcripts out of the workspace is an export. It should require `candidates.export` and/or `calls.read_transcript` on the connection owner, and be audited (D9, D15).
5. **Write-back content respects the decision rule** (section 8.3): facts and human decisions only, no `fitPercent`, no verdicts.
6. **Turn on `webhook` in the use-case definition's `actions` block** rather than adding hiring-only code (D12). Keep integrations pack-agnostic so CustomerVoice and SalesVoice can reuse them with a CRM.
7. **Bring CRM/ATS into the Java side as a port** (G4). Extend the contract to read and list, not only upsert (G3).
8. **UI**: a Settings tab gated by `integrations.*`, an honest status per connection, and the Tools page's "Your own systems: Later" card switching to real state only when it works (D14). Rename the agent page's "Integrations" group (section 7.2).
9. **Cheapest first step:** a results CSV/XLSX export (section 5). It removes the most retyping now and fixes the field list for later write-back.
10. **MCP comes after** stable org-scoped APIs and API keys exist (F1, D7). It is a façade, not the first integration surface.

ASSUMPTION: first customers want "pull candidates in" more than "push results out", because today intake is CSV only. Validate this with the founder or pilot customers. The repo has no customer interview notes on integrations (unverified).

---

## 13. Files read for this map

- Product docs: `BRD's/00_PROJECT_CONTEXT.md`, `01_PRODUCT_STRATEGY.md`, `02_BRD.md`, `03_SYSTEM_ARCHITECTURE.md`, `04_DATABASE_API_SPEC.md`, `05_UX_DASHBOARD_SPEC.md`, `06_PROVIDER_AND_COST_SPEC.md` (sections 1-4 and 13-14), `07_CODING_RULES_FOR_CLAUDE.md` (sections 5-12), `08_DEVELOPMENT_WORKFLOW.md` (phases), `09_MVP_ACCEPTANCE_CRITERIA.md`, `11_PERMISSION_MATRIX.md`, `12_ARCHITECTURE_DECISIONS_FINAL.md`, `README.md`, `10_ADRs/ADR-008`, `ADR-009`. ADR-001 to ADR-007 and `13_SPEC_CHANGES_REQUIRED.md` were searched for integration, webhook, API key, ATS, CRM and calendar terms only.
- `docs/ARCHITECTURE.md`. In `docs/superpowers/specs/`, read in full: `2026-09-16-hiring-production-launch-design.md`, `2026-09-16-voice-agent-platform-design.md`, `2026-09-17-hiring-po-research-pack.md`, `2026-10-02-app-consistency.md`, `2026-10-01-java-spring-ai-backend-design.md` (sections 5-9 and addendum). The other specs were searched for the relevant terms only.
- Web: `apps/web/PRODUCT.md`, `apps/web/lib/api.ts`, `lib/status-labels.ts`, `lib/use-cases.ts`, `lib/use-case-definitions.ts`, `lib/upload.ts`, `lib/hiring-people.ts`, `app/tools/page.tsx`, `app/settings/page.tsx`, `components/settings/*`, `components/candidates/*`, `app/jobs/**`, `app/candidates/page.tsx`, `app/calls/page.tsx`, `app/agents/**`, `app/knowledge/page.tsx`, `app/analytics/page.tsx`, `app/login/page.tsx`, `components/home/first-run.tsx`, `components/layout/app-shell/nav.ts`, `components/site/faq.tsx`, `components/site/chat.tsx`, `public/templates/candidates.csv`.
- Cross-checks: `packages/providers/src/interfaces.ts`, `packages/permissions/src/permissions.ts`, `packages/db/drizzle/0002`, `0015`, `0018`, `0022`, `0026`, `0030`, `apps/api-java/src/main/resources/usecases/hiring.json`, `apps/api-java/src/main/java/desk/hiring/{HiringController,Candidates}.java`, `apps/api-java/src/main/java/desk/authz/Permissions.java`, `apps/api-java/MIGRATION_STATUS.md`.
