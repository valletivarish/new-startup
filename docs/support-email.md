# Support email: outbound and inbound

## Outbound (works today)

Support mail goes through the normal notification transport (`NOTIFICATION_TRANSPORT`):
`console` prints it to the API log, `smtp` sends it (Mailpit locally, any SMTP host in
production, e.g. Resend's SMTP relay at `smtp.resend.com:465` with an API key as the password).

| When | To | Notes |
|---|---|---|
| A customer writes (any channel) | every `PLATFORM_ADMIN_EMAILS` address | Subject `[#<ref>] <subject>`, link to `/admin/support?t=<id>` |
| Staff replies (inbox or email) | the ticket's requester | Subject `Re: <subject> [#<ref>]` |
| A chat message is unanswered for 5 minutes | the requester | Sent once per unanswered message (pg-boss `support.unanswered`); the chat shows a note |

Every support email carries `Reply-To: support+<ref>@<SUPPORT_EMAIL domain>`, so a reply
threads back onto the ticket.

Env: `SUPPORT_EMAIL` (default `support@nexstopp.com`).

## Inbound: `POST /webhooks/inbound-email`

Provider-agnostic. Any service that can POST JSON on receiving mail works.

```http
POST https://<API_URL>/webhooks/inbound-email
Content-Type: application/json
HRVoice-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(INBOUND_EMAIL_SECRET, "<t>.<raw body>")>

{ "from": "Priya <priya@acme.in>", "to": "support+3f9c0a1b2c4d@nexstopp.com",
  "subject": "Re: Calls stuck [#3f9c0a1b2c4d]", "text": "…", "inReplyTo": "<optional>" }
```

- The signature is the same scheme as our outbound webhooks; it must be within 5 minutes of now.
  With `INBOUND_EMAIL_SECRET` unset the route answers 404.
- Threading: the ticket ref is read from `support+<ref>@…` in `to`, then `[#<ref>]` in the
  subject, then `inReplyTo`. Quoted history (`> …`, `On … wrote:`) is dropped.
- A reply is accepted only from the ticket's requester (customer message) or a
  `PLATFORM_ADMIN_EMAILS` address (staff reply: the founder can answer from their mail client).
  Anyone else gets `{"ignored": "sender_mismatch"}` and nothing is written.
- No ref: a new ticket. A sender with an HRVoice account files into their company (with the
  company's last 20 integration errors attached); anyone else becomes an unassigned ticket
  that only the platform admin sees, to link to a company or answer as a lead.

### Pointing a provider at it

Most providers sign with their own scheme, so put a tiny relay in front (a serverless function,
Cloudflare Email Worker, or the provider's webhook transform) that maps their payload to the
JSON above and signs it:

```ts
import { createHmac } from 'node:crypto';
const raw = JSON.stringify({ from, to, subject, text, inReplyTo });
const t = Math.floor(Date.now() / 1000);
const v1 = createHmac('sha256', process.env.INBOUND_EMAIL_SECRET!).update(`${t}.${raw}`).digest('hex');
await fetch(`${API_URL}/webhooks/inbound-email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'HRVoice-Signature': `t=${t},v1=${v1}` },
  body: raw,
});
```

- **Resend** (free tier): add an inbound domain/route for `support@nexstopp.com` (with plus
  addressing), set its webhook to the relay; the `email.received` event has `from`, `to`,
  `subject`, `text`. Verify Resend's own signature in the relay, then re-sign as above.
- **Cloudflare Email Routing**: route `support@` to an Email Worker that parses the MIME
  (`postal-mime`) and posts as above.
- **Mailgun / Postmark / SendGrid Inbound Parse**: point their inbound webhook at the relay;
  their fields map one-to-one.

Local test (no provider):

```sh
SECRET=dev; BODY='{"from":"a@b.test","to":"support@nexstopp.com","subject":"Hi","text":"Hello"}'
T=$(date +%s); SIG=$(printf "%s.%s" "$T" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')
curl -s localhost:3001/webhooks/inbound-email -H 'content-type: application/json' \
  -H "HRVoice-Signature: t=$T,v1=$SIG" -d "$BODY"
```
