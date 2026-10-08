# Optional reminder service (M4 development)

This is an independently operated, single-process Node/SQLite service. It is not installed or started with the Codex plugin. Operators maintain its account registry, private database, TLS endpoint and mail credentials separately from learning workspaces. The public source contains no deployed account, domain or credential.

**Current qualification:** synthetic HTTP/provider/client tests pass locally. No deployed service or real email delivery has been qualified. The Resend adapter is implemented against its official API; local mock success is not actual provider acceptance or delivery.

## Local synthetic run

Use the root's pinned Node/npm and `npm run build`. All addresses and messages in this run must be synthetic. Keep its account token private even though the adapter never connects to a mail provider.

```sh
npm run reminders -- provision --directory "$HOME/codex-study-reminder-mock" --origin http://127.0.0.1:8788
npm run reminders -- serve --directory "$HOME/codex-study-reminder-mock" --origin http://127.0.0.1:8788
```

Provisioning prints one account ID and bearer token. It must run with the service stopped. Save the token outside the learning workspace/source repository in a file readable only by your account; never include it in an issue, shell history or public log. Synthetic mail is retained only in the mock adapter's memory. Use `npm run reminders:demo` for a complete account-verification/sync/acceptance/delivery walkthrough with no manual code extraction.

## API and client

All `/v1/` operations require `Authorization: Bearer <account token>` and mutations require JSON. There is no user ID parameter: authentication determines the account. Unknown fields are rejected. Inputs are limited to 128 KiB; requests and verification emails are bounded. No public registration or admin HTTP endpoint is exposed.

| Operation                   | JSON body                                          | Result                                                            |
| --------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| `PUT /v1/recipient`         | `{ "email": "learner@example.test" }`              | Verification queued; reminders disabled                           |
| `POST /v1/recipient/verify` | `{ "code": "code received by email" }`             | Possession verified; code expires after 15 minutes and works once |
| `PUT /v1/preferences`       | `{ "enabled": true, "timeZone": "Europe/London" }` | Explicit opt-in, only after verification                          |
| `POST /v1/sync`             | Version 1 projection                               | Full replacement of one reminder stream                           |
| `GET /v1/state`             | None                                               | Only this account's snapshots and notification states             |
| `POST /v1/receipt`          | `{ "notificationId": "..." }`                      | Explicit user report of personal receipt                          |

The separate client supports `state`, `recipient`, `verify`, `preferences`, `sync` and `receipt`:

```sh
npm run reminder-client -- --endpoint https://reminders.example.test --token-file /absolute/private/account-token --operation sync --input /absolute/private/projection.json
```

`--synthetic` allows loopback HTTP for the mock only. Remote credentials require HTTPS; redirects are refused. The local `study reminder-preview` / `study_reminder_preview` operation prepares data without transmitting it. Review the exact projection before requesting a sync. Input files for verification contain a short-lived private code and belong outside the repository.

Every reminder has an unsubscribe link. GET shows a minimal confirmation form so link scanners cannot change preferences. POST disables all reminders for that account and suppresses pending work. The email headers also support one-click unsubscribe. The product's main interface remains CLI/Codex; this single-purpose unsubscribe form is the only service HTML.

## Delivery and recovery

The contract and queue behavior are specified in [REMINDERS.md](../../docs/REMINDERS.md). The worker wakes every 15 seconds. It persists a stable delivery identity and exact payload before contacting the provider. Snapshot refresh never changes a payload already being retried. Messages are not scheduled at the provider in advance: immediately before sending, the worker rechecks verification, opt-in, current snapshot, cancellation, event time and freshness.

Send responses establish `accepted`. The service polls the provider's authenticated retrieval API at most every five minutes for seven days; a matching explicit delivery result establishes `delivered`, and only the authenticated recipient's report establishes `personallyReceivedAt`. Poll errors retain the prior state. Bounces/failures disable reminders until the recipient is verified again. Synthetic results always carry `providerMode: synthetic` and do not establish real delivery.

Timeouts, rate limits and transient provider failures retry the same key and body, with exponential delay. There are at most five attempts, a two-hour reminder catch-up window and a 23-hour outer retry bound. Resend's deduplication window is 24 hours; an ambiguous attempt beyond our bound becomes `unknown` and requires operator investigation. Never automatically resend an unknown outcome under a new ID. Already accepted mail cannot be recalled. A cancellation that arrives while a provider call is in flight takes effect after that call returns and blocks subsequent sends; it cannot undo that request.

The database also binds retries to a digest of the provider implementation version, sender and API credential. Raw provider credentials are never stored there. Restarting with a different sender or credential is refused before any mail request, including an API-key rotation: the service cannot infer whether a replacement key belongs to the same provider account. Preserve the ledger and reconcile prior attempts before a reviewed configuration migration; do not reset the database or remove this binding to force a retry. Automated credential/sender migration is not implemented. An older real-mail ledger with prior attempts but no binding is similarly refused for reconciliation; untouched/synthetic ledgers can add the binding safely.

The lock file allows only one process per database. A crash can leave `service.lock`; confirm the recorded process has stopped before removing that lock, then restart on the same database. Persisted submitting jobs wait until their lease expires, then follow the same bounded retry policy. Keep the database and account records together in private backups; loss of the ledger destroys deduplication guarantees. No automatic backup, multi-instance deployment or high-availability guarantee is implemented.

## Real deployment gate

Before operating real mail, choose a dedicated test host/domain and recipient, configure TLS reverse proxying to `127.0.0.1:8788`, and place persistent private storage outside this checkout. Use separate databases for mock and real modes; the service refuses switching modes on an existing database. It is not suitable for ephemeral/serverless filesystems.

The operator supplies `RESEND_API_KEY` with send and email-retrieval access, a verified sender address in `STUDY_REMINDER_FROM`, and `STUDY_REMINDER_LIVE=1`, then explicitly selects `--provider resend`. The service never reads school credentials. Do not paste keys into chat or commit an environment file. Sender/domain setup, provider limits and TLS are operator responsibilities; no infrastructure is deployed by these source changes.

Real acceptance requires: exact-commit hosted CI, verified recipient, one explicitly authorized synthetic reminder, provider acceptance ID, independently retrieved delivery result, recipient confirmation, opt-out, cancellation/rescheduling checks and recorded limitations. Store sensitive receipts in the operator's private environment, and only redacted status in public pilot records. This gate has not yet run.
