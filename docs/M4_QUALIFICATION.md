# M4 deployment qualification

This is a sanitized evidence summary. Actual addresses, hosts, account tokens, provider receipts, databases and configuration backups remain in private operator storage. A test deployment is not a general availability or high-availability claim.

## Fixed candidate

- Source: `bb58b3f816798ac0d9f442b6b9223a5026426c6f`.
- Tree: `6f706c67350d2c65a6a87f372b1e95a60d22a446`.
- [GitHub CI run 37854522675](https://github.com/Zuwei-Wang/codex-study/actions/runs/37854522675): Ubuntu 24.04 and macOS 15 both succeeded, including 46 behavioral tests and the real Codex plugin integration.
- Clean-export build: Node 24.21.0, npm 11.12.1; service archive SHA-256 `a611e8f113cad20811fcb2b66799d8e23b6322abfef4449b4e3265ea97eac2ad`.
- Test host observed on 2026-10-09: Linux x86_64, Ubuntu 26.04, systemd 259, Caddy 2.11.4. Runtime Node 24.21.0; target production dependencies reinstalled with npm 11.12.1 after detecting a different bundled npm.

## Completed deployment checks

- Dedicated unprivileged process, loopback listener, resource limits, immutable release and private persistent database.
- Cloudflare-proxied hostname, independently issued origin certificate, authenticated origin pulls, valid public HTTPS and uncached responses.
- Existing shared-host application routes were unchanged; both checked HTTP endpoints returned 200 before and after the proxy reload.
- The shipped Node client successfully authenticated over the public HTTPS endpoint. Missing and invalid credentials were rejected.
- Two synthetic accounts proved isolation. The actual deployed worker executed one synthetic send and poll. Repeated identical sync did not create another attempt.
- Synthetic verification/opt-in, cancellation, rescheduling, stale snapshot and revision rejection, unsubscribe GET without mutation and POST with suppression all passed.
- A clean process restart preserved the exact account/stream/notification state and send count. These are synthetic provider results; no real recipient received this synthetic test.
- A dedicated real-provider key passed email-retrieval capability checks and the selected sender domain reported verified. Real and synthetic databases are separate.

## Real-recipient gate (passed for one recipient)

A single owner-authorized Gmail recipient was used with original synthetic reminder content; no course data or other recipient was involved.

- The first verification email was accepted and delivered on 2026-10-09. The owner confirmed receiving it, but its 15-minute code had expired by the next session. A fresh code was requested normally, delivered, read from the authorized mailbox and successfully verified through the shipped HTTPS client. The account stayed disabled until the explicit test opt-in.
- At 2026-10-09 19:09:27 UTC, the service synchronized one immediate test reminder and two future cancellation/rescheduling fixtures. Repeating identical revisions returned unchanged results. A newer revision suppressed the cancelled reminder and the old schedule without attempting either send. Older revisions and expired snapshots returned 409; a separate real-mode account could not see or acknowledge these records.
- The one immediate reminder was accepted at 19:09:30 UTC and reported delivered at 19:09:45 UTC, with exactly one send attempt. A separate authenticated retrieval of that exact provider message matched its ID, recipient and test subject and reported `delivered`.
- The real email's unsubscribe GET left opt-in unchanged. Its POST disabled the account and suppressed the remaining future reminder. A subsequent sync was rejected. The final queue had zero waiting reminders, three suppressed reminder jobs with zero attempts, and one delivered reminder with one attempt.
- A stopped-ledger private backup was taken, then the real process restarted. The full externally visible state, opt-out and send count were unchanged. This is a clean restart and backup-creation check, not a restore or crash-recovery qualification.

The owner explicitly confirmed receiving the identified test reminder in the conversation. That report was recorded through the authenticated receipt API at 2026-10-09 19:13:47 UTC as `personallyReceivedAt`; the provider state remains `delivered`. This completes M4's one-recipient live qualification. The test account remains opted out with no waiting reminders; independent M5 participant feedback is still pending.

## Remaining limits

Small pilot only. No unattended school-browser qualification, load test, host reboot test, crash recovery exercise, automatic backup or restore qualification, credential migration or multi-instance deployment was established by this run. The owner still needs to arrange M5's 2–3 independent participants. Refer to the [operations procedure](DEPLOYMENT.md) and [milestone ledger](ACCEPTANCE.md).
