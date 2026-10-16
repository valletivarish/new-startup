# Connecting customers' hiring systems: the plan in one page

Date: 3 October 2026. This is the short version for the founder. The full plan and its evidence are in the files linked at the end.

## What customers will be able to do

- A team that uses Zoho Recruit connects it once, by signing in to Zoho from HRVoice and picking which jobs to bring in.
- New applicants on those jobs show up in HRVoice within about 15 minutes, ready to call.
- A recruiter clicks Call for each person, as today.
- After each call, a short note goes back into Zoho Recruit on that person: how the call went, their answers to the must-ask questions, and a link to the recording.
- The note never contains a score or a recommendation. A person on the customer's team still decides.
- People already rejected or hired in Zoho Recruit cannot be called by mistake.
- Later, if a customer switches it on, their decisions in HRVoice can also update the status in Zoho Recruit. It waits two minutes, so they can undo.
- A customer with its own developer, or a no-code automation tool such as Zapier, can send candidates in and read results out instead.
- Every customer can download a job's results as a spreadsheet file.
- If something breaks, the settings page says what went wrong, and an admin gets one email.

## What we build first, in order

1. Move the live product onto the rebuilt server (the Java version), with supervised test calls and an alert if it goes down. By this step at the latest, also decide who may make real calls from a new sign-up (question 4 below); this risk exists today.
2. Groundwork: one phone number format, one clear word for each call result, and strict rules on what may ever leave HRVoice.
3. A "download results" spreadsheet button on each job.
4. A safety fix we need anyway: how long we keep data and how we delete it (before the first paying customer or public launch).
5. Once a pilot confirms its system: the Zoho Recruit connection, or a connection for a customer's own developer, with "remove this person" working first.
6. If a pilot asks: sending decisions back to Zoho Recruit as a status change.
7. Only if a developer customer needs instant updates: messages pushed to their system.

Rough estimate: five and a half to seven weeks of one engineer for a Zoho pilot after step 1. Add about two weeks for the data-keeping work if the pilot pays.

## What we deliberately leave for later, and why

- **Calling many people with one click.** It is a large calling project of its own, with phone-line capacity and legal questions. The design is saved but not approved.
- **Calling imported people automatically.** It needs legal advice on consent, calling hours and do-not-disturb rules.
- **Letting customers' AI (artificial intelligence) assistants, such as ChatGPT or Claude, read HRVoice.** Later, when a paying customer asks.
- **Letting the voice agent reach into a customer's systems by itself during a live call.** Avoided. Only the candidate is on the line, nobody can approve anything, and a candidate could try to trick it.
- **Simple in-call actions, such as booking an interview slot.** Later, designed when needed.
- **Buying a ready-made connection service.** Later, once three or more paying customers need different hiring systems. Today it costs more per customer and does not cover common Indian systems.
- **Reaching into a customer's own database.** Avoided. It is risky for them and for us.
- **Google Sheets, a second hiring system, instant updates from Zoho, and spotting people deleted in Zoho.** Next, chosen by what pilots actually use. Instant updates from Zoho need its paid plans.

## Where the experts still disagree

Six of the seven experts approve the plan, with changes. The seventh, the Critical Reviewer, will not approve until one Zoho detail is fixed: if Zoho stops at about 2,000 records (not yet confirmed), the way we planned to read applications would miss the newest applicants. Their fix is simpler than ours. A short test on a free Zoho account and an answer from Zoho support must settle it before any Zoho work starts; we do not control when Zoho answers.

Earlier, six review rounds did not agree. The plan settled only after we cut calling many people at once out of it and moved the ordered event log out of the shared core into the developer connection.

## Questions only you can answer

Questions 1 to 5 must be answered before we can give any pilot a date.

1. Where do your first five pilots keep candidates today, and if it is Zoho Recruit, is its "Applications" feature on? [Ask all five before we build any connection.]
2. Is one Call click per imported person fine for the first pilots? [Yes, for a few dozen people a day.]
3. May we switch the live product to the rebuilt server, which all of this needs? [Yes.]
4. Who may make real calls from a newly signed-up workspace? [Only once we switch calling on for them, with a verified email and a small monthly limit; done no later than the move to the rebuilt server. Also: does any pilot call outside India?]
5. How long do we keep recordings, transcripts and people's details? [Decide before the first paying customer or public launch.]
6. Is a wait of about 15 minutes for new applicants acceptable? [Yes; also ask each pilot how many jobs they keep open.]
7. What goes into the note we write in Zoho Recruit? [Outcome, answers and a link; no summary.]
8. Should calls that did not connect also leave a short note? [Yes, one short note each.]
9. Is it fine that details of people from Zoho Recruit can only be edited there? [Yes.]
10. May a status change in another system ever change a decision in HRVoice? [No.]
11. May "not moving forward" also set a reject status in Zoho Recruit, which may email the candidate? [Not for the first pilot; notes only.]
12. May the name "Zoho Recruit" appear on screen? [Yes.]
13. Is it fine that we keep imported people until someone removes them in HRVoice, even if Zoho deleted them? [Yes, for pilots.]
14. Should HRVoice ever call imported people automatically? [No, not now.]
15. May a customer's own developer connection receive interview answers? [Only when an admin chooses it.]
16. If the person who connected Zoho leaves, is it fine that the connection pauses until an admin takes over? [Yes; admins get one email.]
17. What do we charge per customer, and do we promise "data stays in India"? [No data-location promise yet.]
18. Should HRVoice write its own call summary? [Not now.]
19. Will future support and sales products reuse the same job and candidate lists? [Decide when the second product is designed.]
20. Do you accept the integration decision record that makes this plan official? [Yes.]

## Links to the other files

- Full architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Decision record, waiting for you: [ADR-010-integration-layer.md](../../BRD's/10_ADRs/ADR-010-integration-layer.md)
- Calling many people at once (saved, not approved): [later-bulk-calling.md](later-bulk-calling.md)
- The agreed plan in full detail: [architecture-draft-v13.md](architecture-draft-v13.md)
- Every decision and why: [02-resolutions.md](02-resolutions.md)
- How the seven experts compared: [01-comparison.md](01-comparison.md)
- The seven expert reports: [research/](research/)
