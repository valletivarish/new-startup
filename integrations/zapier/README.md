# HRVoice for Zapier

A Zapier Platform CLI app (`zapier-platform-core` 19.1.0, CommonJS) over the public `/v1` API. It has no logic of its own: consent, calling hours (9:00–20:00 India time), limits and the no-score rule are all enforced by the API.

| Kind | Key | What it does |
|---|---|---|
| Trigger (REST hook) | `call_completed` | A screening call ended and the candidate answered: answers, summary, transcript |
| Trigger (REST hook) | `call_failed` | No answer, busy, voicemail, too short, or skipped |
| Action | `add_candidate` | Adds a candidate to a job. **Consent is a required yes/no field**; without it the app refuses before sending anything |
| Action | `start_call` | Queues a screening call (held until 9:00 IST when outside calling hours) |
| Action | `raise_ticket` | Opens a support ticket |
| Action | `create_job` | Creates a job with must-ask questions and a language |
| Search | `find_candidate` | Finds a candidate on a job by your ID (`externalId`) or phone (last 10 digits) |
| Hidden | `job`, `candidate` | Dynamic dropdowns |

How the hooks work: subscribing creates a `/v1/webhook-endpoints` entry for the Zap's URL and one event; Zapier stores the returned id and signing secret. Each delivery's `HRVoice-Signature` is checked against that secret (HMAC-SHA256 of `t.body`, 15-minute window), and anything unsigned or forged is dropped. Unsubscribing deletes the endpoint. Sample data in the Zap editor comes from `GET /v1/events` (the latest real call events, in the same shape), falling back to the static sample.

The API key needs the scopes `jobs`, `candidates`, `calls`, `results`, `webhooks` and `support`.

## Tests

```sh
pnpm --filter @hrvoice/zapier test        # every perform, through Zapier's appTester, against a fake HRVoice
CLIENTS_API_PORT=3011 pnpm test:clients    # check 12 drives this app against a real local stack
```

`HRVOICE_API_URL` overrides the API origin (default `https://nexstopp.com/backend`); it is for tests only.

## Publishing (the founder, with the company's Zapier account)

1. Install the CLI that matches the core version, and sign in:
   ```sh
   npm install -g zapier-platform-cli@19.1.0
   zapier login
   ```
2. The CLI does not understand pnpm's linked `node_modules`, so build from a plain npm copy:
   ```sh
   rm -rf /tmp/hrvoice-zapier && cp -R integrations/zapier /tmp/hrvoice-zapier
   cd /tmp/hrvoice-zapier && rm -rf node_modules && npm install
   ```
3. First time only: `zapier register "HRVoice"` (pick the Human Resources category, intended audience "private" for now). This writes `.zapierapprc`; copy it back into `integrations/zapier/` and commit it, so later pushes go to the same app.
4. Every release: bump `version` in `package.json`, then
   ```sh
   zapier validate
   zapier push
   ```
5. In developer.zapier.com → your app: add the logo (square PNG, 256×256 or larger), the description, homepage `https://nexstopp.com`, and the support link. Zapier also asks for a privacy-policy URL; there is no such page on nexstopp.com yet.
6. Try it in the Zap editor with a `hrv_test_` key: connect, run "Test trigger" (it shows recent call events once a test call has ended), and test each action.
7. Invite the first clients: `zapier users:add their@email 1.0.0`, or share the invite link from the Sharing page.
8. Going public: the Publishing tab in developer.zapier.com lists Zapier's current requirements (live users, review, help docs). Submit from there; Zapier reviews it.
