# 05. Product and UX architect: connecting a customer's system

Date: 2026-10-03. Author role: Product / UX architect. Research only. No code, config, migration or test was changed.

Repo root: `/Users/valletivarish/Documents/new startup/`. Paths are relative to it. The two baseline maps are `docs/integrations/00-current-system-backend.md` ("backend map") and `docs/integrations/00-current-system-product.md` ("product map").

Labels:
- **FACT**: verified in the repo (path given) or in a vendor's documentation (URL given).
- **RECOMMENDATION**: my proposal.
- **ASSUMPTION**: believed, not verified.
- **unverified**: I looked and could not confirm it.

---

## 1. Summary

1. Build **one** real connection first: **Zoho Recruit**, connected by OAuth from a new Settings tab. Of the systems I could check, it is the only one that has all four of these: it is sold to Indian SMBs, it lets a customer authorize us with one click, it has an India data centre, and its free plan can call the API. Keka is second (V2). Its API is a paid add-on, and only a Global admin can create the client id, client secret and key, so the customer has to paste three values. Greenhouse and Lever are Later: both require their partner programme before a vendor can offer one-click OAuth.
2. Ship a **results CSV export** at the same time or earlier. It removes the retyping that every customer has today, whatever system they use. It also fixes the list of fields that write-back sends.
3. The connection needs about **four decisions** from the customer, and we can pre-fill most of them:
   - which jobs to link;
   - which of their statuses means "ready for a screening call";
   - whether a decision in our app should also change their status;
   - if it should, which of their statuses equals "Moved forward" and which equals "Not moving forward".

   We decide everything else: the field mapping, the content of the result note, how often to sync, and who is shown as the author.
4. What we write back is facts plus decisions that a person made. It is never a rating or a recommendation. In MVP the result goes back as a **note** on the candidate. Changing the candidate's **status** in their system is **off by default**. When it is on, the change happens **only** after a named person in our app makes a decision. Two competitors I found write back a recommended disposition, or move stages automatically from screening outcomes. Our product rule forbids both, and that is a selling point we should state.
5. In MVP, candidates who arrive from the customer's system **are not called automatically**. They appear on the job's board as "Not called yet", labelled "From Zoho Recruit". A recruiter presses Call, which is today's rule: every phone call starts from a human click. Automatic calling is V2. It is gated on a founder decision about consent, India's commercial-call rules (TRAI TCCCPR) and budget caps.
6. **Status and error states** follow the calling-number card's pattern: one plain sentence and a badge. The badges are "Connected", "Needs attention", "Paused" and "Not connected". Reconnecting keeps every mapping. Disconnecting keeps everything already in our app.
7. **Not in MVP**: a unified API (Merge, Kombo and similar), an MCP server, a public REST API and API keys, our own Zapier app, customer webhooks, SFTP, Google Sheets sync, a per-field mapping editor, two-way sync of contact fields, and auto-dialing.

---

## 2. Findings

### 2.1 What the app gives us to build on

| # | Label | Finding | Source |
|---|---|---|---|
| A1 | FACT | Settings is a set of tabs chosen by `?section=`. Each tab appears only when the person has the permission. Today the tabs are Workspace, Team, Access levels, Activity and Your account. Adding a tab is a small, local change. | `apps/web/app/settings/page.tsx:32`, `:83-89` |
| A2 | FACT | The "Calling number" card already shows an external connection as three plain states, each a badge plus one sentence ("Not connected yet", "Verification pending", "Ready to call"). It has a Retry alert when the status check fails. This is the pattern a connection card should copy. | `apps/web/components/settings/sections.tsx:238-318` |
| A3 | FACT | The Tools page already has a "Your own systems" card, marked "Later": "Sending results to the HR software you already use, and other connections. Not built yet." | `apps/web/app/tools/page.tsx:106-119` |
| A4 | FACT | The Access levels editor hides the "Integrations" permission group because the area is not built yet. `integrations.read/create/update/delete` are seeded: read for Owner, Administrator, Agent manager and Recruiter; create, update and delete for Owner and Administrator. | `apps/web/components/settings/access.ts:108-109`, `packages/db/drizzle/0002_seed_permission_matrix.sql:63-66`, `BRD's/11_PERMISSION_MATRIX.md:89-93` |
| A5 | FACT | `sourceLabel()` turns `candidate.source` into words: "From a resume", "From a CSV", or "Added by hand" for anything else. It shows in the board row meta and on the Details tab. The DB allows only `manual` and `resume`. | `apps/web/components/candidates/CandidateDetailSheet.tsx:86-92`, `apps/web/app/jobs/[id]/candidates/page.tsx:1094`, `packages/db/drizzle/0015_hiring_desk_foundation.sql:20` |
| A6 | FACT | The candidate sheet has three tabs: Results, Call and Details. The decision buttons sit in a footer that is visible on every tab. | `apps/web/components/candidates/CandidateDetailSheet.tsx:254-256` |
| A7 | FACT | The client error filter discards any server message that contains "webhook", "api key", "token", "payload", "provider", "sdk", a URL or a vendor name such as "google". The filter decides what a person sees, so integration error text must be written in plain words. | `apps/web/lib/errors.ts:67-90` |
| A8 | FACT | The UI rules: one primary button per view; real-world and destructive actions go through `ConfirmDialog`; status is always an icon plus a word; raw values never reach the screen; "Missing counts are left out, never 0"; "workspace", not organization; "the people you allow", not roles or permissions; no vendor names (speech, model, telephony). | `docs/superpowers/specs/2026-10-02-app-consistency.md` sections 3, 4, 5, 8 |
| A9 | FACT | Every phone call starts from a human click (`calls.initiate`). Auto-retry is coded but switched off and has no dispatcher. | backend map section 18 item 9, `apps/api-java/MIGRATION_STATUS.md:373` |
| A10 | FACT | The product never recommends hire or reject. The words "shortlisted, rejected, hire, score, fit" are banned. | `apps/web/PRODUCT.md:56`, `docs/superpowers/specs/2026-10-02-app-consistency.md` section 8 |
| A11 | FACT | The website FAQ says ATS integration is "Not yet". The site chatbot treats "naukri, zoho, workday, greenhouse, excel, csv, spreadsheet" as ATS questions. | `apps/web/components/site/faq.tsx:53-55`, `apps/web/components/site/chat.tsx:298-321` |
| A12 | FACT | "Shipping fake webhook/MCP UI" is listed as an anti-pattern. | `docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md:88` |

### 2.2 Which systems matter first for Indian SMB hiring teams

The evidence is thin. No neutral, India-specific usage survey turned up in my searches. The strongest signals are listed below, weakest last.

| # | Label | Finding | Source |
|---|---|---|---|
| M1 | FACT (vendor-written) | An Indian AI-screening vendor names three dominant systems: Darwinbox ("the dominant HRMS for large Indian enterprises"), Keka ("the most widely used HRMS among Indian mid-market companies") and Zoho Recruit (agencies, IT staffing firms and SMEs). | https://babblebots.ai/blog/ats-integration-darwinbox-keka-zoho-recruit |
| M2 | FACT (vendor-written) | An India ATS comparison calls Zoho Recruit "the default standalone ATS for Indian SMEs and staffing agencies" (about ₹2,500 per recruiter per month). It describes Keka as HRMS-bundled, Darwinbox as an 8 to 12 week enterprise deployment, and also lists greytHR, Naukri Hiring Suite and TurboHire. | https://www.thehirehub.ai/blog/best-applicant-tracking-system-india-2026 |
| M3 | FACT | Zoho Recruit has a Forever Free plan. | https://zapier.com/blog/best-applicant-tracking-systems/ |
| M4 | FACT | Freshworks is ending Freshteam and stopped renewals from 7 March 2026. | https://www.peoplematters.in/news/business/freshworks-to-end-freshteam-hr-product-stop-renewals-from-march-2026-47939 |
| M5 | FACT | In a 600+ team sample of mostly US agencies, Zoho Recruit was under 1%. Global ATS share data does not describe Indian SMBs. | https://www.pin.com/blog/ats-market-share-report/ |
| M6 | FACT | Naukri sends applicants into Greenhouse and Lever through "Naukri Amplify" (Zwayam). The customer sets it up with webhooks in the ATS. For many teams Naukri is a source that feeds an ATS, not the system of record. | https://support.greenhouse.io/hc/en-us/articles/16297968058651-Naukri-integration, https://help.lever.co/hc/en-us/articles/20087453586333-Enabling-and-using-the-Naukri-Amplify-integration |
| M7 | unverified | I found no public developer documentation for a Naukri RMS API. | searches above |
| M8 | ASSUMPTION | Many first customers keep candidates in Excel or Google Sheets and Naukri exports, with no ATS. The repo records no customer interviews. The product map says the same thing (product map U9). | `apps/web/components/site/chat.tsx:298-321` |

**RECOMMENDATION.** The order:

1. Zoho Recruit (MVP).
2. Keka Hire (V2).
3. One of the following, depending on what pilots actually use: a Google Sheet connection, or a Zapier app for the long tail (V2).
4. Greenhouse and Lever (Later, after the partner programmes).
5. Darwinbox (Later, enterprise).
6. Freshteam (Avoid: it is being discontinued).
7. Naukri RMS (Avoid until a documented API exists).

Before any code is written, the founder should ask the first five pilot customers one question: "Where do your candidates live today?" (open question Q1).

### 2.3 How each system authenticates, and what that means for our screens

| # | Label | Finding | Source |
|---|---|---|---|
| Z1 | FACT | **Zoho Recruit** uses OAuth 2.0 with the authorization code grant. Scopes can be narrow, for example `ZohoRecruit.modules.candidates.READ` or `ZohoRecruit.modules.jobopenings.ALL`. | https://www.zoho.com/recruit/developer-guide/apiv2/oauth-overview.html |
| Z2 | FACT | Zoho has several data centres; India is `accounts.zoho.in` and `https://www.zohoapis.in/recruit/v2/`. The authorization response carries `location` and `accounts-server`, and the app must use them for every later call. The customer does not have to choose a region. | https://www.zoho.com/recruit/developer-guide/apiv2/multi-dc.html |
| Z3 | FACT | **API credits per rolling 24 hours:** Free 5,000 (fixed). Standard is 5,000 + 250 per user, up to 100,000. Professional is 10,000 + 500 per user. | https://www.zoho.com/recruit/developer-guide/apiv2/limits.html |
| Z4 | FACT | Zoho Recruit has a **Change Status** API. A status can be set per job by passing `jobids`; Zoho's example value is `"Qualified"`. There is a **Create Notes** API (Notes attach to Candidates, not to Applications) and an **Attachments** API (up to 20 MB; Applications supported). | https://www.zoho.com/recruit/developer-guide/apiv2/change-status.html, https://www.zoho.com/recruit/developer-guide/apiv2/create-notes.html, https://www.zoho.com/recruit/developer-guide/apiv2/upload-attachment.html |
| Z5 | FACT (secondary) | Zoho Recruit workflow rules can call a webhook when a record is created or a field changes. Webhooks need the Standard plan or higher, and the customer has to build the rule by hand in Zoho's settings. | summarised from Zoho help search results: https://help.zoho.com/portal/en/kb/recruit/developer-guide/developer-console/dev-console-workflow-rules/articles/dev-console-workflow-rules |
| Z6 | FACT | Zoho's own AI ("Zia") gives a candidate a rating of how well they match the job. The candidate record can carry a score that **we must never write to or copy from**. | https://zapier.com/blog/best-applicant-tracking-systems/ |
| K1 | FACT (secondary, consistent across 3 guides) | **Keka**: "The API module is an add-on feature." Only the Global admin can create keys. The path is Settings > Integrations & Automations > API access. The client id and secret are shown only once. A token needs `client_id`, `client_secret`, `api_key`, scope `kekaapi` and the company subdomain. | https://developers.keka.com/reference/authentication, https://help.keka.com/hc/en-us/articles/39946790747665-Getting-Started-with-Keka-API, https://docs.stackone.com/connectors/keka/guides/link-account/api-key |
| K2 | FACT | The Keka Hire API lists jobs, lists the candidates on a job, and can post a candidate to a job. | https://developers.keka.com/reference/get_v1-hire-jobs, https://developers.keka.com/reference/get_v1-hire-jobs-jobid-candidates |
| G1 | FACT (secondary, consistent) | **Greenhouse** Harvest v1/v2 was scheduled to retire on 31 August 2026. v3 is OAuth only. Partners use the authorization code flow, and partner credentials come only through the Greenhouse partner programme. A customer can create client-credentials keys for its own custom integration. Actions are attributed to the authorizing user. | https://support.greenhouse.io/hc/en-us/articles/10568627186203-Greenhouse-API-overview, https://harvestdocs.greenhouse.io/docs/authentication |
| L1 | FACT (secondary, consistent) | **Lever**: partner OAuth apps are registered by Lever staff, who send the client id and secret. A customer API key is for internal use and only a Super Admin can see it. | https://hire.lever.co/developer/oauth, https://help.lever.co/hc/en-us/articles/20087297592477-Generating-and-using-API-credentials |

**RECOMMENDATION.** Plan for two connect patterns, and build only the first in MVP.

- **Pattern A, "Sign in to <system>" (OAuth).** One button, then a redirect, then back to us. Zoho Recruit uses it now, and Greenhouse, Lever and HubSpot later.
- **Pattern B, "Paste your keys" (V2, for Keka).** A form with the three fields Keka requires. Each field has a "Where do I find this?" line that names the exact Keka menu path. A plain note says that only the Keka Global admin can create keys and that the Keka API is a paid add-on. Kombo Connect's flow does the same thing: it shows "which credentials are required to set up the tool and how to get them" (https://docs.kombo.dev/connect/introduction).

### 2.4 What the reference flows teach (Zapier, Make, HubSpot, Merge, Kombo)

| # | Label | Finding | Source |
|---|---|---|---|
| R1 | FACT | **Zapier** polling triggers run every 1 to 15 minutes depending on the user's plan; the Free plan polls every 15 minutes. Instant triggers use REST hooks: Zapier calls a subscribe URL when a Zap is turned on and an unsubscribe URL when it is turned off. New static webhook triggers are not accepted for public integrations. | https://docs.zapier.com/integrations/build/trigger, https://docs.zapier.com/integrations/build/cli-hook-trigger, https://help.zapier.com/hc/en-us/articles/8496244568589-How-Zap-triggers-work |
| R2 | FACT | Zapier's Zoho Recruit app offers polling triggers ("New Record", "Updated Record", "New or Updated Record in View") and actions ("Create Record", "Update Record", "Update Record Status", ...). | https://zapier.com/apps/zoho-recruit/integrations |
| R3 | FACT | "Webhooks by Zapier" is a premium app and is not available on the Free plan. | https://help.zapier.com/hc/en-us/articles/8496326446989-Send-webhooks-in-Zaps |
| R4 | FACT | A **HubSpot** install is a single URL carrying `client_id`, `scope`, `optional_scope`, `redirect_uri` and `state`. Optional scopes can be dropped by the installing account, so the app must read which scopes were actually granted. | https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes, https://developers.hubspot.com/docs/apps/legacy-apps/authentication/oauth-quickstart-guide |
| R5 | FACT | **Merge Link** runs in this order: pick an integration, authorize, then return. Passing an `integration` parameter "takes your user straight to that integration's configuration step". | https://docs.merge.dev/merge-unified/merge-link/single-integration |
| R6 | FACT | **Kombo Connect** shows the customer "an overview of the requested data points" and "which credentials are required … and how to get them". "Magic links" let a customer finish setup without the vendor writing code. | https://docs.kombo.dev/connect/introduction |
| R7 | FACT | **Merge** pricing: Launch is free for 3 production linked accounts, then $650 a month up to 10, then $65 per account after that. | https://help.merge.dev/en/articles/6641605-self-serve-with-merge-free-and-launch-plans-faq |
| R8 | FACT | A phone-screening company built on Kombo writes "candidate assessments highlighting requirements and cultural fit" and "automatically moves candidates to appropriate next stages based on screening outcomes". | https://www.kombo.dev/case-study/how-classet-built-their-real-time-phone-screening-with-kombo |
| R9 | FACT | An Indian competitor writes back an "AI interview score … recommended disposition (Proceed / Hold / Reject)" to Darwinbox. | https://babblebots.ai/blog/ats-integration-darwinbox-keka-zoho-recruit |
| R10 | FACT (vendor blog) | The most common breakage is stage drift: the customer renames or adds a stage, and a hard-coded mapping silently breaks. The advice is to read the stage list from the ATS at runtime. | https://www.thehirehub.ai/blog/recruitment-platforms-ats-integration-2026-guide |

**RECOMMENDATION.** Lessons we take from these flows:

- **(a)** Before the redirect, say what we will read and write, in plain words. This is Kombo's "requested data points" step.
- **(b)** Jump straight to the chosen system's sign-in. Do not show a picker with one entry in it (Merge's `integration` parameter).
- **(c)** After OAuth, read back what was actually granted, and stop if something is missing (HubSpot's optional scopes).
- **(d)** Read the customer's status list live, every time the settings open and before every status write, so a renamed stage shows up as "Needs attention" instead of failing silently (R10).
- **(e)** Make R8 and R9 our contrast. We send what was said and who decided; we never send a verdict.

### 2.5 Regulation that touches automatic calling

| # | Label | Finding | Source |
|---|---|---|---|
| T1 | FACT | TRAI's TCCCPR Second Amendment (12 Feb 2025) requires every sender to notify its originating access provider in advance, in writing, before using auto-dialers or robo-calls, and to state their purpose. Service and transactional calls are to use the 160 series. | https://trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf |
| T2 | unverified | Whether a screening call to someone who applied for a job counts as a "service" call, and what consent it needs when the dial is triggered by an ATS rather than by a person. Secondary sources disagree on penalties and on how long consent lasts. | secondary blogs in the same search; needs legal advice |

**RECOMMENDATION.** Keep the human click in MVP (A9). Treat "call automatically when a candidate reaches status X" as V2, after the founder gets legal advice (open question Q3).

---

## 3. The proposed customer experience

All copy below is a draft in the product's own words (A8). "Zoho Recruit" names the customer's own system. The no-vendor-names rule covers our infrastructure vendors (speech, model, telephony). It does not cover the system the customer chose, and the rule should say so in writing (open question Q6).

### 3.1 Where it lives

- **RECOMMENDATION.** Add a new Settings tab, **"Connected systems"**, at `?section=connections`, between Access levels and Activity. It is shown when the person holds `integrations.read`. The Connect, Reconnect and Disconnect buttons need `integrations.create`, `integrations.update` and `integrations.delete`. Someone who has only `integrations.read` (for example a Recruiter, A4) sees the status and the hint "Ask a workspace admin to connect it" (the same words as the first-run steps, `apps/web/components/home/first-run.tsx`).
- **RECOMMENDATION.** When the first connection ships:
  - unhide the Integrations group in `apps/web/components/settings/access.ts:109`;
  - change the Tools page "Your own systems" card from "Later" to the live state, linking to the tab;
  - change the FAQ answer (A11) to name only the systems that actually work.
- **RECOMMENDATION.** Rename the agent page's existing "Integrations" group (product map 7.2) before launch, so the two meanings never sit side by side.
- **RECOMMENDATION.** Add a 4th step to Home's first-run card, shown only if the workspace has no connection and no candidates: "Bring in candidates. Connect Zoho Recruit or upload a CSV." It needs no new data, because the step reads the connection list.

### 3.2 The flow, step by step (Pattern A, Zoho Recruit)

| Step | What the person sees | What we decide for them | Source of the pattern |
|---|---|---|---|
| 0. Tab empty state | `EmptyState`: "Bring candidates in from the hiring system you already use, and send each call's results back to it." One primary button, "Connect Zoho Recruit". A secondary line: "Using something else? Upload a CSV on any job, or tell us what you use." The second part is a mail-to shown as text. No cards for systems that do not work (A12). | Only systems that really work are listed | A8, A12 |
| 1. Before sign-in | A dialog titled "Connect Zoho Recruit". It has two plain lists. **"We'll read"**: job openings you pick, and the candidates on them (name, mobile, email, resume text, status). **"We'll write"**: a note on each candidate after a call (what was asked, what they said, a link back), and their status, but only if you turn that on later. Then: "We never send a score or a recommendation." The button is "Continue to Zoho Recruit". | Scopes are fixed by us at the narrowest level that works (Z1). There is no scope picker. | Kombo's requested data points (R6) |
| 2. Sign in | Redirect to Zoho. The customer signs in and approves. The India data centre is handled automatically (Z2). | — | Merge single integration (R5), HubSpot install URL (R4) |
| 3. Back in our app | A full-page step (not a modal, so it works at 390px): "Pick the jobs to bring in". It lists their open job openings with title and candidate count. Every row starts **unticked**. Each ticked row offers "Link to an existing job" (a dropdown of our jobs whose titles match closely) or "Create a new job" (we copy the title and description into a new draft job). | We match titles to pre-select a link. A new job copies title and description, and the person still adds must-ask questions on the job's Setup page, as today. | — |
| 4. "When should someone appear here?" | One select per connection (not per job, in MVP), read live from their status list: "Bring people in when their status is…". We pre-select the first status whose name contains "new", "screen" or "applied". If none matches, nothing is pre-selected. Helper text: "People already at this status come in too." | The pre-fill. The person confirms it. | R10 |
| 5. "Send decisions back?" | A switch, **off by default**: "When someone on your team moves a candidate forward or not, change their status in Zoho Recruit too." Turning it on shows two selects: "Moved forward becomes…" and "Not moving forward becomes…", each read live from their list. "On hold" and "No decision yet" are never sent. | Off. The result note is always sent and cannot be switched off in MVP; it is the point of the connection. | Section 4 below |
| 6. Check | Button "Check the connection". It reads, never writes. Success: "We can see 3 jobs and 41 people at Applied." Names are shown only if the person holds `candidates.read_pii`. Failure: the reason in plain words and the next step (section 3.4). | — | Calling-number card (A2) |
| 7. Turn on | Primary button "Start bringing people in". Toast: "Connected. New people will show up on your jobs within 10 minutes." The card then shows "Connected", the last check time, the linked jobs and "Connected by Priya". | Sync interval (RECOMMENDATION: 10 minutes; ASSUMPTION that it fits the 5,000 free credits, Z3) | — |

**RECOMMENDATION. Minimum configuration.** Two required choices: which jobs, and the trigger status. One optional choice: decision write-back, with its two status picks. Nothing else is configurable in MVP:

- no field-mapping editor;
- no per-job trigger;
- no choice of note content;
- no sync-frequency setting.

Every one of these can be added later once a customer asks for it.

### 3.3 Field mapping: what we infer and what we never ask

| Our field | From Zoho Recruit | Who owns it after linking |
|---|---|---|
| Job title, description | Job opening title and description | Our app, after the first copy. The JD drives the call prompt, and silent changes would change what the agent says (backend map section 13). A later "Update from Zoho Recruit" button is V2. |
| Candidate name, mobile, email | Candidate fields | **Zoho Recruit.** RECOMMENDATION: on linked candidates these fields are read-only in our app, with the hint "Edit this in Zoho Recruit; it updates here within 10 minutes". This avoids any two-way conflict logic. |
| Phone format | Mobile, plus the country if present | We run it through the same validation and `+91` default that the CSV import uses (`apps/api-java/src/main/java/desk/hiring/CandidateImport.java`). An invalid number arrives anyway, marked "Number not valid", with "Fix it in Zoho Recruit". |
| Resume text | Resume attachment text, if readable | Read-only. We use the existing extraction. Text only, as today. |
| One row per (candidate × job) | A Zoho "application" (a candidate associated with a job opening) | Matches our job-scoped candidates (backend map 6.2). |
| Must-ask questions | **Never imported.** ATS scorecards and interview kits are a different thing. | Our app |
| Zia rating, any score field | **Never read, never written** (Z6) | — |

### 3.4 Status, errors, reconnect, disconnect

**RECOMMENDATION.** Use one card per connection, in the same layout as "Calling number" (A2): a badge plus one sentence, then at most one action.

| State | Badge (icon + word) | Sentence | Action |
|---|---|---|---|
| Connected | success, "Connected" | "Last checked 4 minutes ago. 3 jobs linked. Connected by Priya." | "Change jobs" (secondary) |
| Needs attention: access withdrawn or expired | warning, "Needs attention" | "Zoho Recruit stopped letting us in. Nothing new is coming in and results are waiting to be sent. Sign in again to pick up where it stopped." | "Sign in again" (primary). This is Reconnect: it reruns step 2 and keeps every choice. |
| Needs attention: a mapped status was renamed or removed | warning, "Needs attention" | "The status 'Phone screen' isn't in Zoho Recruit any more. Pick the one to use now." | "Choose a status" |
| Needs attention: missing access | warning, "Needs attention" | "The Zoho Recruit account that connected can't see job openings. Ask your Zoho Recruit admin, then sign in again." | "Sign in again" |
| Paused: daily limit | neutral, "Paused until tomorrow" | "Zoho Recruit's daily limit for your plan was reached. We'll carry on automatically at 4:10 pm." | none |
| Couldn't check | error `Alert`, "Couldn't check Zoho Recruit" | Plain cause | "Retry" (as in A2) |
| Not connected | neutral, "Not connected" | empty state (step 0) | "Connect Zoho Recruit" |

- **RECOMMENDATION.** When the state becomes "Needs attention", email the person who connected it, plus Owners, once per incident, using the existing `Notifications` queue (backend map section 10). There is no in-app notification centre today (product map G8).
- **RECOMMENDATION.** All the sentences above avoid the words the error filter discards (A7): no "token", "webhook", "API key" or "OAuth". The server should return a stable `code` (for example `connection.reauth_needed`) and the web should map codes to these sentences, the same way it maps the telephony status. That way no server text has to pass the filter.
- **RECOMMENDATION. Disconnect.** Use a `ConfirmDialog` with `tone="danger"`:
  - Title: "Disconnect Zoho Recruit?"
  - Body: "New people stop coming in and results stop going back. Everyone already here stays, with their calls and results. Nothing is deleted in Zoho Recruit."
  - On confirm we revoke the grant where the system allows it, and write an audit event.
  - Linked candidates keep the "From Zoho Recruit" label. Their contact fields become editable again.

### 3.5 What the recruiter sees day to day

| Where | Change | Source it builds on |
|---|---|---|
| Job's candidates board, row meta | "From Zoho Recruit", replacing "Added by hand" | `sourceLabel()` (A5). Needs a new `source` value; the DB check constraint is a backend change. |
| Board header, linked job only | A quiet line: "Linked to Zoho Recruit · 3 new since 10:40" (shown only when the number is known; A8 "missing counts are left out") | — |
| Candidate sheet, Details tab | "From Zoho Recruit" with "Open in Zoho Recruit" (a link to the record). Contact fields read-only with the hint. | `CandidateDetailSheet.tsx:477` |
| Candidate sheet, Results tab, under each call | A delivery line: "Sent to Zoho Recruit at 11:02" / "Waiting to send" / "Couldn't send. Retry" (Retry needs `integrations.update`). | Built on `result.ready` (backend map section 16) |
| Decision footer, when decision write-back is on | Under the buttons: "Also sets their status in Zoho Recruit to 'Shortlisted for interview'." The customer's own label is shown, as they named it. | A6 |
| Bulk decisions | The same line in the bulk bar: "Also updates 12 people in Zoho Recruit." | `apps/web/app/jobs/[id]/candidates/page.tsx:1174-1230` |
| Undo after a decision | Undo also reverts the status we wrote in Zoho Recruit, if it was already sent. If the revert fails: "Couldn't undo in Zoho Recruit. Change it there." | `toastUndo` |
| Settings > Activity | New sentence types: "Priya connected Zoho Recruit", "12 people came in from Zoho Recruit", "Result sent to Zoho Recruit for Ravi Kumar" | existing audit log |

### 3.6 What the note in Zoho Recruit says (draft)

This is the only content we write automatically. It is attached to the candidate record, because Zoho Notes do not attach to Applications (Z4).

```
HRVoice screening call · Sales executive · 3 Oct 2026, 11:02 · 6 min
Outcome: Call completed            (or: No answer / Reached voicemail / Number not valid)

What they said
- Notice period: 30 days
- Current location: Pune
- Expected salary: not answered

Summary
<summary text after AdviceGuard.scrub>

Recording and full transcript: <link to the candidate in HRVoice; sign-in required>
A person on your team decides who moves forward. HRVoice does not score or recommend.
```

- **RECOMMENDATION.** Do not paste the transcript into the note, and do not attach the recording. Link to our app instead. The link keeps the recording and transcript behind `calls.read_transcript` and `calls.read_recording` (product map D15), and it keeps candidate PII from leaking across systems.
- **RECOMMENDATION.** Never write "must-ask coverage %", `fitPercent`, or any Zoho rating field (backend map 6.3).
- **RECOMMENDATION.** Customers will want to tune the note. Answer that in V2 with a single toggle, "Include the transcript", not with a template editor.

---

## 4. Automatic status write-back and the "a person decides" rule

| # | Label | Statement |
|---|---|---|
| H1 | FACT | Stages change only through a person's action. Each change records who made it in the audit log (`hiring.candidate_status_changed`, with `actor_user_id`). Source: backend map 6.2. |
| H2 | RECOMMENDATION | A status write-back happens **only** as a result of H1, never from a call outcome. "Call completed" and "No answer" are facts and go only into the note. The call outcome never moves a status in their system. |
| H3 | RECOMMENDATION | Any status write records the person's name, as "Moved forward by Priya Sharma in HRVoice". It goes in the `comments` field of Zoho's Change Status API (Z4) and in the note. The authorizing account is the API caller (Greenhouse documents the same attribution model, G1), so the name in the text is what tells their team who decided. |
| H4 | RECOMMENDATION | Off by default, and both target statuses are chosen by the customer. If they map "Moved forward" to a status called "Qualified" (Zoho's own example, Z4), that is their label for a person's decision. We still never pick it for them and never pre-fill it. |
| H5 | RECOMMENDATION | "On hold" and "Clear decision" (back to `new`) are not sent in MVP. They have no reliable counterpart, and sending them invites accidental reversals. |
| H6 | RECOMMENDATION | Our sales line: "Your team decides; HRVoice writes down what was said and who decided." It sets us against R8 and R9. |
| H7 | ASSUMPTION | Some customers will ask us to "auto-reject people who didn't answer". The answer is no. That would be a decision made by the system, not by a person. Offer a "Didn't connect" filter and the existing bulk decision bar instead. |

---

## 5. Positions by topic

| Topic | Position | Phase | Rationale | Concerns |
|---|---|---|---|---|
| First integration | Zoho Recruit, OAuth, read job openings and candidates, write one note per result, optional status on a human decision | MVP | Indian SMB fit (M1 to M3), one-click OAuth (Z1), India data centre (Z2), API on the free plan (Z3), documented status and notes APIs (Z4) | The evidence for Indian usage is vendor-written. Validate with pilots (Q1). The free plan's 5,000 credits a day caps polling. Zoho marketplace listing requirements are unverified. |
| Onboarding UX | One Settings tab, 7 steps, 2 required choices, read-only check before turning on, calling-number-style status card | MVP | Reuses existing patterns (A1, A2, A8). Merge, Kombo and HubSpot show the same order (R4 to R6). | Step 3 (linking jobs) is the only step with real cognitive load. Usability-test it with one recruiter. |
| OAuth | We are an OAuth **client** of Zoho now, and of Greenhouse, Lever and HubSpot later. We are **not** an OAuth provider. | MVP (client) / Avoid (provider) | One click for the customer. No secrets pasted. | Refresh tokens need encrypted storage with a key that is not `BETTER_AUTH_SECRET` (backend map section 12). |
| API keys | Customer-pasted keys for systems without partner OAuth (Keka). Our own hashed, scoped keys for customers (D7) only when a public API exists. | V2 | Keka needs it (K1). Our own keys serve the Zapier app and custom apps. | Keka's three-field paste and Global-admin-only access add friction. Write help text naming the exact menu path. |
| Service accounts | No new UI concept. A connection acts as a system actor, shown as "via Zoho Recruit (connected by Priya)" in Activity. | MVP (attribution only) | People must see who connected it and who decided (H3). | Backend must not let the connection bypass PII redaction (backend map section 5). |
| Webhooks | Inbound from Zoho: not MVP. Polling avoids asking the customer to build a workflow rule, and works on the free plan (Z5). Outbound customer webhooks: V2, together with the public API. | V2 | "Connect once" means no setup in their system. Ten-minute polling is fast enough for a screening queue. | A customer may want instant pickup. Offer an optional "Faster: add this rule in Zoho Recruit" guide in V2. |
| REST API | No public API in MVP. The connection screens use internal session routes. | V2 | Nobody asked for it yet. It is a prerequisite for the Zapier app and MCP. | Needs versioning, OpenAPI and per-key rate limits, none of which exist (backend map section 18). |
| SDK / embedded | Do not build an embeddable widget or SDK. | Avoid | Our customer is a recruiter in our app, not a developer. | — |
| MCP | Facade over the public API. | Later | Already decided (product map F1). No customer flow needs it. | — |
| Direct DB | Never connect to a customer's database, and never give customers ours. | Avoid | SMBs on SaaS ATSs have no DB to offer. It is a security and support burden. | — |
| Event / queue | Internal only: `result.ready` and human decisions go into a durable outbox, delivered through `background_jobs`. The UX reads the delivery state ("Sent", "Waiting", "Couldn't send"). | MVP | Needed for honest delivery status (section 3.5) and Retry. | Today's events are in-memory and repeat (backend map sections 9 and 16). A dedupe key is a must, or Zoho gets duplicate notes. |
| Customer-side connector | No agent installed on the customer's machines. | Avoid | Indian SMBs use SaaS ATSs. On-prem is enterprise territory. | — |
| File / SFTP fallback | **Results CSV export** (MVP), plus the existing CSV import. No SFTP. | MVP (CSV) / Avoid (SFTP) | Covers every customer without a supported system. Defines the write-back fields. Gated by `candidates.export` and audited. | Exports carry PII. Keep the Analyst exclusion (product map D9). |
| Canonical model | Use the existing nouns: Job, Contact (candidate × job), Call result, Decision (product map D11). Add only provenance: system, external id, last synced. No generic "unified ATS" schema. | MVP (minimal) | One connector does not justify a canonical layer. | Keep it pack-agnostic so the CRM use cases can reuse it. |
| Sync engine | Polling per connection every 10 minutes, for linked jobs only. One-way in (contact fields owned by the ATS). One-way out (notes, optional status). No conflict resolution. | MVP | Making linked fields read-only (section 3.3) removes the need for two-way merge logic. | Interval vs Zoho credits (Z3) is unverified for large accounts. |
| Two-way actions | Writes limited to: create a note on `result.ready`, and change status on a human decision (opt-in). | MVP (limited) | Facts and human decisions only (section 4). | Undo across systems (section 3.5). The renamed-status edge case (section 3.4). |
| Multi-tenancy | One connection per system per workspace. Mappings belong to the workspace. Everything runs under the existing tenant context. | MVP | Matches RLS and the workspace model. | A workspace with two Zoho accounts is an edge case: refuse it and explain why. |
| Security | Narrowest scopes; encrypted credentials; no transcript or recording copied out (link only); each export and write is audited; PII shown in the "Check" step only to holders of `candidates.read_pii`. | MVP | Product rules (product map D15). DPDP Act exposure for candidate data (ASSUMPTION). | Secret storage does not exist yet (backend map section 12). |
| Build vs buy (unified API) | Build the first connector directly. Re-evaluate a unified API when three or more systems are requested by paying customers. | Later | Merge Launch is $650 a month from the 4th linked account (R7). Indian coverage varies: Kombo lists Zoho Recruit; Knit lists Keka and Darwinbox (searches above). One connector does not justify it. | Their pickers show dozens of systems we cannot support well. Their data models carry score and rating fields we must strip. |
| Other: automatic calling on arrival | A per-job switch "Call new people automatically" with call hours and a daily cap. Needs the `scheduled_calls` dispatcher. | V2 | This is the founder's end goal ("agents perform the workflow"). | Consent, TRAI rules (T1, T2), DND, budget. A founder decision is required (Q3). |
| Other: Google Sheet connection | Use Google Picker with the `drive.file` scope, which is non-sensitive and avoids sensitive-scope verification. Pick one sheet, map 3 columns, sync like an ATS. | V2 (if pilots live in Sheets) | The "connect once" version of the CSV import. | Google brand verification is still needed. Column drift is the same problem as stage drift. Source: https://developers.google.com/workspace/drive/api/guides/api-specific-auth |
| Other: our own Zapier app | Triggers ("Result ready", "Decision made") as REST hooks, and an action ("Add candidate"). | V2 | Covers the long tail without a connector each (R1, R2). | Needs a public API, API keys and REST hook subscribe and unsubscribe endpoints. Zapier's webhook app is paid (R3). |
| Other: Keka Hire | Pattern B (paste keys). Same steps 3 to 7. | V2 | Second most-named Indian system (M1, M2). | API add-on cost to the customer. Global-admin dependency (K1). Write-back endpoints for notes and status are unverified. |
| Other: Greenhouse, Lever, Darwinbox | Partner programmes first for Greenhouse and Lever (G1, L1). Darwinbox is enterprise. | Later | Few Indian SMB buyers (M2). | Partner timelines are outside our control. |
| Other: Freshteam, Naukri RMS | Freshteam is being discontinued (M4). Naukri has no documented API (M7). | Avoid | — | Re-check Naukri if a pilot insists. |

---

## 6. What not to build (MVP)

1. **No integrations marketplace or grid of logos.** List only systems that work (A12).
2. **No field-mapping editor.** We infer the mapping (section 3.3).
3. **No per-job trigger statuses, filters or rules builder.** One trigger status per connection.
4. **No two-way editing of contact fields.** The ATS owns them, and they are read-only here.
5. **No automatic dialing, no automatic stage moves, no automatic rejection.** A person clicks Call and a person decides.
6. **No writing of scores, ratings, coverage %, "qualified" picked by us, or summaries containing advice.**
7. **No transcript or recording copied into the ATS.** Use a link.
8. **No inbound webhook setup guide in MVP.** Polling only.
9. **No unified API vendor, MCP server, public API, API keys, Zapier app, SFTP, embedded widget or on-prem connector.**
10. **No sync-frequency, note-template or scope settings.**
11. **No second connector until the first has two paying customers using it** (RECOMMENDATION; the threshold is a judgment call).

---

## 7. Open questions (founder only)

- **Q1.** Where do your first five pilot customers keep candidates today: Zoho Recruit, Keka, Naukri RMS, Google Sheets or Excel, or something else? This decides whether Zoho Recruit or a Google Sheet comes first.
- **Q2.** Will you apply to the Zoho Marketplace, and later the Greenhouse and Lever partner programmes? I did not verify Zoho's listing requirements and review time.
- **Q3.** Automatic calling when a candidate arrives: are you willing to place calls the recruiter did not click, given the TRAI TCCCPR auto-dialer notice rule (T1), consent (T2) and DND? This needs legal advice before V2.
- **Q4.** Is a result note in their ATS that links back to us (sign-in required) acceptable to customers? The alternative is pasting the transcript, which moves candidate PII across systems.
- **Q5.** Should Recruiters (who hold `integrations.read`) be able to press "Retry" on a failed send, or only Admins? This decides whether "Retry" needs `integrations.update`.
- **Q6.** Will you write down that a customer's own system name (for example "Zoho Recruit") may appear in the UI, as an exception to the no-vendor-names rule?
- **Q7.** Pricing: is the connection included in usage-based pricing, or a paid extra? It affects whether the Tools page card says "Included".
- **Unverified.**
  - Zoho Recruit support for `If-Modified-Since` or modified-time filters for cheap polling.
  - Whether Keka Hire has write endpoints for notes and status.
  - Whether Naukri RMS has an API.
  - Neutral data on Indian SMB ATS share.
  - Whether Greenhouse's 31 August 2026 v1/v2 shutdown happened on schedule.
