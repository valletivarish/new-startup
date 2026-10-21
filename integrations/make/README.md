# HRVoice for Make

A Make custom app, as the JSON blocks Make's app editor takes. Everything goes through the public `/v1` API with the customer's API key, so consent, calling hours (9:00–20:00 India time), limits and the no-score rule are enforced by the API.

| File | Goes into |
|---|---|
| `base.json` | App → Base |
| `connection/api.json`, `connection/parameters.json` | Connection → Communication, Parameters |
| `webhooks/call-events/{api,parameters,attach,detach}.json` | Webhook → Communication, Parameters, Attach, Detach |
| `rpcs/listJobs/api.json` | Remote procedure → Communication (the job dropdown) |
| `modules/<name>/meta.json` | The module's type, label, description (and webhook) in the "Create a module" dialog |
| `modules/<name>/{api,expect,interface}.json` | Module → Communication, Mappable parameters, Interface |

Modules: **Watch call events** (instant trigger: call completed / call failed), **Add a candidate** (consent is a required yes/no; HRVoice refuses the candidate without it), **Start a screening call**, **Raise a support ticket**, **Create a job**, **Find a candidate** (search, by your ID or phone).

`pnpm --filter @hrvoice/make test` checks every file parses, every request is a documented `/v1` route, consent is required, and nothing names a score.

## Setting it up in Make (the founder, with the company's Make account)

1. Make → **Custom apps** (left menu; on some plans under "My apps") → **Create a new app**. Name `hrvoice`, label `HRVoice`, description "Phone-screen candidates and get their answers when the call ends.", theme `#1f2a44`, language English. Upload the logo (square PNG, 512×512).
2. **Base**: replace the content with `base.json`.
3. **Connections** → Create a connection: label `HRVoice`, type **Other**. Paste `connection/api.json` into Communication and `connection/parameters.json` into Parameters.
4. **Remote procedures** → Create: name `listJobs`, connection `HRVoice`. Paste `rpcs/listJobs/api.json`.
5. **Webhooks** → Create: name `call-events`, label "Call events", type **Dedicated**, connection `HRVoice`. Paste the four files into Communication, Parameters, Attach and Detach.
6. **Modules** → Create one module per folder in `modules/`, using the type, name (the folder name), label and description in its `meta.json`, connection `HRVoice`; for `watchCallEvents` also pick the `call-events` webhook. Paste `api.json`, `expect.json` and `interface.json` into Communication, Mappable parameters and Interface.
7. Try it: a scenario with **HRVoice → Watch call events** and a `hrv_test_` key (key scopes: jobs, candidates, calls, results, webhooks, support), plus **Add a candidate** and **Start a screening call** in another scenario. Test calls are free.
8. Share: the app's **Publish** button makes it installable by invite link. To be listed for everyone, use **Request review**; Make reviews custom apps against its own checklist.

Security note: Make webhooks cannot check the `HRVoice-Signature` HMAC. The Make webhook address is a long random URL that only HRVoice is given; anyone who needs certainty can confirm an event with `GET /v1/calls/{callId}`.
