# Driving the buttons

`npm test` proves what can be proved by reading the code and the schema. These
three scripts prove the rest: that pressing the button does the thing.

They run a real browser against a running instance and check the database and
the mail and payment providers afterwards, so a button that says "Sent" and
sends nothing fails here.

| Script | What it drives |
| --- | --- |
| `portal-account.mjs` | Owner adds a service, invites a customer, the invitation email really leaves, the customer signs up from the link, every tab in the portal opens, they ask for work, message the business, correct their details — and the request and the message arrive on the business's side. Then: a customer cannot open the application, and a signed-out visitor cannot open the portal. |
| `portal-reports-and-payments.mjs` | A report written through the form, marked completed, emailed — checked against the provider's own record, including that the attachment is a real PDF. Then the customer's copy, their PDF download, another customer's PDF refused, and an invoice paid by card end to end: session priced from the invoice, created on the business's connected account, settled only by the webhook, and not double-credited on redelivery. Finishes on a phone-sized viewport. |
| `portal-failures.mjs` | The provider refusing a message. An invitation that could not be emailed says so and offers the link; a report that could not be sent is **not** marked as sent, keeps the reason, and never appears in the customer's account. Then the retry once the provider recovers, and the notifications a customer should and should not see. |

## Running them

They need an instance with a database, a mail provider and a payment provider
they can talk to. Against a local stack:

```bash
npm run build && npm start                 # the app, on the URL in the scripts
npm i --no-save playwright-core            # not a dependency of the project
node tests/e2e/portal-account.mjs
node tests/e2e/portal-reports-and-payments.mjs
node tests/e2e/portal-failures.mjs
```

Each prints a line per check and exits non-zero if any fails.

The constants at the top of each file — the app's URL, the two sign-ins, and
the addresses of the mail and payment stand-ins — are what you change to point
them somewhere else. They expect a business named `Demo Construction Services`
with the seeded demo data (`npm run db:seed`), and a customer they can invite.

The stand-ins are two small HTTP servers that speak the providers' own
protocols: the mail one checks the `Authorization` header, records what
arrived, and can be told to start refusing (`GET /__fail`, `/__ok`); the
payment one signs webhooks with the real HMAC scheme so a forged one is
rejected by the app rather than by the test. Point `RESEND_BASE_URL` and
`STRIPE_BASE_URL` at them. Against the real providers, drop those two variables
and use test keys.
