# Recruiter-grade screening: requirements, follow-ups, fit and "Meets all"

Date: 21 October 2026. Status: approved by the founder ("yes make the changes", "meet all").

## Why

The founder wants the agent to work like a real HR screener, not a form reader: probe answers ("why eighteen lakh?"), check them against what the job needs, and hand HR a decision-ready result so screening gets easier. Real recruiters (SHRM, Indeed, Indian practice) prepare the non-negotiables before dialling, ask the same core questions of everyone, probe big hikes and vague answers, score against criteria straight after the call, and close with clear next steps.

## Decision (founder, 21 Oct)

The agent scores every screened candidate **against the requirements HR wrote for the job** and sorts them into **Meets all / Check / Doesn't meet**. HR moves people forward in one click; a per-company setting **"Auto-advance candidates who meet all requirements"** (off by default) moves Meets-all candidates forward automatically. The AI never invents criteria or gives its own opinion of a person; every verdict is "requirement X: met / not met / unclear" with the evidence (quote + second in the call). It never tells the candidate they are rejected.

This replaces the earlier product rule "never recommends hire or reject" with: "never judges a person on its own; it checks HR's stated requirements and shows the evidence. HR decides, or HR chooses to auto-advance on its own criteria." PRODUCT.md is updated to say so.

## Goals

1. **Requirements sheet per job** (Setup step, next to must-ask questions): structured, all optional:
   - Salary budget: min and max per year (INR lakh), "flexible" toggle.
   - Maximum notice period (days).
   - Work mode + location (on-site / hybrid with N office days / remote; city).
   - Must-have skills or experience (up to 5 short lines, e.g. "3+ years Java").
   - Shift / night work required (yes/no).
   The JD assistant can pre-fill these from the job description ("Fill from description" button, reviewed by HR before saving).
2. **The agent on the call** (own voice loop prompt and the ElevenLabs baseline prompt both):
   - Knows the requirements before dialling; asks the must-ask questions and the standard screen set when not already covered: reason for change, notice (and whether negotiable), current and expected CTC, offers in hand / other interviews, work-mode fit.
   - Follow-up rules: expected hike over ~30% or above budget → ask what's behind it and whether there's flexibility; answer outside a requirement → state the requirement gently and ask about flexibility ("The range for this role is around 5 lakh. Is there flexibility?"); vague answer → re-ask once in other words; "I don't know" → move on. At most one follow-up per topic.
   - Never asks off-limits questions (age, religion, caste, marital status, family plans, health) and steers away if the candidate raises them.
   - If a hard requirement clearly fails, finishes the essentials briefly and closes politely; never says "rejected".
   - Closes with clear next steps ("the hiring team will review and get back to you within N working days"; N from the job, default 3).
3. **Fit sheet after each call**: Gemini (Vertex, existing extraction path) compares the extracted answers with the requirements: per requirement `met | not_met | unclear`, a one-line evidence quote, the second it was said, plus flags HR should know (competing offer, flexibility stated, contradiction, candidate asked something unanswered). Overall: `meets_all` (all set requirements met), `doesnt_meet` (any not_met that the candidate didn't offer flexibility on), else `check`. Stored with the session. No requirements set → no fit (shows "Add requirements to sort candidates").
4. **App**:
   - Candidates board: filter/sort lanes **Meets all · Check · Doesn't meet · Not screened**, with counts; row shows the fit chips.
   - Candidate drawer: a **Fit** block above the summary: each requirement with met/not met/unclear, evidence quote and a play-from-second chip; flags below.
   - Home "Ready for review": Meets-all first, with the fit chips.
   - Settings → Workspace: "Auto-advance candidates who meet all requirements" toggle (admin only), with a one-line explanation. When on, a Meets-all result moves the candidate forward (same action as the "Move forward" button), recorded in the audit log as an automatic action with the fit attached, and shown in the drawer ("Moved forward automatically: met all 5 requirements").
5. **Sample call on the website**: the agent asks "That's a good jump from thirteen. What's behind the eighteen?" and the answers panel shows the fit chips for the sample job (illustrative).

## Non-goals (this round)

Auto-reject (never; "Doesn't meet" always waits for a person). Scoring personality or communication. Changing the public /v1 result shape (fit stays inside the app for now). Languages beyond what the voice loop already supports.

## Constraints

- Existing RLS / tenant context patterns; new columns via migration 0035; Drizzle schema in step.
- Gemini via the existing Vertex config; extraction never throws (falls back to "unclear").
- Off-limits list and the "never tells the candidate they're rejected" rule are tested.
- All copy plain recruiter language; WCAG 2.2 AA; 44 px targets.

## Left to the builder

Exact table/column shapes (jobs.requirements jsonb is fine), prompt wording within the rules above, chip styling within the D2 app style.
