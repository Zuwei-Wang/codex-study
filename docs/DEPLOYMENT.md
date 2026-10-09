# Operate an isolated reminder test service

The reminder server is optional and separate from the local plugin. Its interface is the authenticated API and CLI; there is no home page or administration UI. A browser visit without an account token returns 401. The unsubscribe confirmation page is its only HTML interface.

This procedure describes a persistent Linux host behind a TLS reverse proxy. Obtain explicit authorization for the host, DNS and real recipient before configuring them. Keep actual hostnames, account tokens, provider keys, database files and delivery evidence in private operator storage outside this repository. The [qualification ledger](M4_QUALIFICATION.md) records what has actually been checked.

## Release and runtime

1. Select an exact source commit with successful authenticated GitHub CI on both supported platforms. Record its commit, tree and run URL. A successful local build is not this gate.
2. Build from a clean export of that commit using Node **24.21.0** and npm **11.12.1**. Run `npm ci --ignore-scripts` and `npm run build`. Record the archive SHA-256. Copy only the lockfile, package metadata, license, compiled `dist/packages/core`, `dist/packages/cli` and `dist/services/reminders` into the service artifact. Do not copy a learning workspace or a macOS `node_modules` directory onto Linux.
3. Install the official Node distribution under an isolated runtime directory, verify its SHA-256 against the official distribution checksum, and check its version. Install npm 11.12.1 under a dedicated prefix if the bundled npm differs; do not assume a Node release bundles the repository's pinned npm. Avoid changing a shared host's global runtime.
4. Extract the artifact into a new release directory. On the target OS, use the pinned npm to run `ci --omit=dev --ignore-scripts`. Keep dependency installation logs privately. The server does not need the Codex CLI or an agent runtime.
5. Make the release and runtime root-owned and readable, but not writable, by the service account. Run the application as a dedicated unprivileged account. Keep its writable SQLite directory outside the release, mode 0700, and its files mode 0600.

Deployment evidence must distinguish the source commit, build artifact, Linux dependency installation and host configuration. Ubuntu 24.04 hosted CI and an Ubuntu 26.04 test deployment are different environments; the latter requires its own smoke checks.

## Process and network isolation

Use a separate systemd unit with an absolute runtime path, fixed release directory and the existing `serve` command. Start with `--provider synthetic` and a separate synthetic data directory. Bind the application's port to loopback; the server already enforces `127.0.0.1` binding. Check for port conflicts before choosing the port.

The tested unit uses `User`/`Group`, `UMask=0077`, `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `PrivateDevices`, an empty capability bounding set and an explicit writable data directory. It limits memory to 256 MiB, swap to zero, CPU to 50% of one core and tasks to 32. Adapt these limits to actual load; this is a small pilot configuration, not a capacity guarantee. Do not enable `MemoryDenyWriteExecute` without validating the Node/V8 runtime.

Use bounded `Restart=on-failure` and startup limits. After `systemctl start`, wait for the application's HTTP listener, not just systemd's `active` state: a `Type=simple` service can be active before it listens. An unauthenticated `/v1/state` request must return 401, while the operator's token must return the expected provider mode. Stop/start testing must also confirm the lock is released cleanly. A crash can leave a lock; confirm its PID is no longer running before removing it. Never silently remove a live process's lock.

Back up the existing reverse-proxy configuration privately before adding a dedicated hostname. Validate the proposed configuration before a graceful reload; check existing applications before and after. Keep existing application routes, credentials and firewall rules intact. Do not expose the application port publicly.

For Cloudflare-proxied DNS, point a new, unused hostname at the selected host and keep the proxy enabled. Use HTTPS to the origin and a certificate covering that exact hostname. An existing certificate for another subdomain does not cover the new name. The test deployment obtained a dedicated certificate through Caddy's ACME HTTP-01 challenge, retained authenticated origin pulls and used a separate virtual host. TLS-ALPN validation does not pass through Cloudflare's HTTP proxy; the tested issuer used HTTP-01 only. Validate against the actual firewall and Cloudflare settings; do not weaken existing origin authentication to obtain a certificate.

Do not cache authenticated responses or log authorization headers, bodies or unsubscribe URLs. Keep `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The service limits request bodies to 128 KiB; match that limit at the proxy. With the current loopback reverse proxy, the server's per-peer request limit is effectively shared by clients. High-volume or hostile multi-tenant use needs a separate rate-limit design.

## Mail configuration and activation

Before creating the real-mode database, validate a dedicated Resend key and verified sender domain. A **Sending access** key can send mail but cannot retrieve its delivery status. Automatic delivery polling requires a key with email retrieval access; Resend's Full access option also exposes other account APIs and cannot be restricted to one domain. The account owner must approve that scope. Do not silently reuse a business application's credentials or broaden an existing key.

Save `RESEND_API_KEY`, `STUDY_REMINDER_FROM` and `STUDY_REMINDER_LIVE=1` in a private root-owned environment file outside source control. Reference it through the service manager; do not put values in command arguments, unit descriptions, logs or chat. Use a fresh, separate real-mode database and `--provider resend`. The ledger binds the sender and key, so choose them before sending. Changing either later is refused even during key rotation; preserve the ledger and follow the reconciliation guidance in the [service runbook](../services/reminders/README.md).

Provision accounts while that database's service is stopped. Capture the one-time token directly into a mode-0600 private file. Start the service and use the shipped reminder client over HTTPS to request verification for the explicitly agreed recipient. Recipient verification and explicit opt-in must succeed before a projection is accepted.

For a first real trial, use one clearly labeled synthetic reminder with no course data. Record the same notification's queued state, provider acceptance ID, authenticated delivery result and the recipient's independent receipt confirmation. Polling may take five minutes after an initially incomplete result. Do not submit `receipt` on behalf of a user who has not confirmed receipt. Exercise cancellation, rescheduling and opt-out without sending obsolete reminders, then leave the trial account disabled with no waiting work.

## Verification and recovery

- Test missing/invalid credentials, strict input validation and account isolation through the public HTTPS endpoint using the actual client/runtime. Test unsupported clients explicitly: a Python-default request was blocked at the edge during this trial while the shipped Node client succeeded. This does not authorize disabling edge protection.
- In synthetic mode, test verification, opt-in, repeated sync, worker execution, stale snapshots, revision conflicts, cancellation, rescheduling, unsubscribe GET/POST and clean restart persistence. Synthetic codes may be obtained from synthetic fixture storage for this check; real verification must prove possession through the mailbox.
- In real mode, do not infer delivery from a 2xx send response or from the synthetic provider. Preserve provider and recipient evidence separately. Keep private evidence out of public issues and commits.
- Before maintenance, stop the affected service and copy its complete SQLite directory and operator configuration into a protected backup. Restoring only part of the ledger can break deduplication. There is no automatic backup/restore qualification or multi-instance support yet.
- To stop this test deployment, disable its service first and verify no worker remains. Preserve its ledger and credentials for reconciliation. Remove only its dedicated proxy stanza and DNS record after reviewing their ownership; validate and reload the proxy. Do not restore a whole old shared proxy configuration over unrelated subsequent changes.

References: [Cloudflare DNS records](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/), [Caddy imports](https://caddyserver.com/docs/caddyfile/directives/import), [Caddy TLS](https://caddyserver.com/docs/caddyfile/directives/tls), [Resend API keys](https://resend.com/docs/dashboard/api-keys/introduction).
