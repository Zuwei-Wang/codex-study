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

## Real-recipient gate

With the owner's authorization, the deployed service queued a verification email at 2026-10-09 18:48:58 UTC, received provider acceptance at 18:49:00 UTC, and retrieved a matching delivered result at 18:49:15 UTC. Exactly one send attempt was recorded. This qualifies the verification-email transport only; the recipient has not yet completed verification or confirmed personal receipt. Verification completion, the actual synthetic-content reminder, independently retrieved delivery result, personal receipt, final opt-out and real-mode cancellation/rescheduling remain pending. No real delivery qualification is claimed from the checks above.

## Remaining limits

Small pilot only. No unattended school-browser qualification, load test, host reboot test, crash recovery exercise, automatic backup/restore qualification, credential migration or multi-instance deployment was established by this run. The owner still needs to arrange M5's 2–3 independent participants. Refer to the [operations procedure](DEPLOYMENT.md) and [milestone ledger](ACCEPTANCE.md).
