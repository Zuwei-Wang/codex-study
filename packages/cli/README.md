# Local CLI

Run `npm run build`, then `npm run study -- --help` from the repository root. Commands: `init`, `upgrade`, `course`, `import`, `task`, `progress`, `attempt`, `snapshot`, `read`, `note`, `nav`, `doctor`, `calendar`, `scan-prepare`, `scan-record`, `scan-apply`, `schedule-configure`, `schedule-finish`, `reminder-preview`. The separate `reminder-client` script contacts an explicitly configured optional service.

The wrapper validates options and delegates to core. Commands use `--workspace PATH`; writes stay under `PATH/.study`, except recoverable initialization staging directories in `PATH`. `read` takes exact-version reading JSON; `note` takes a cited note plus the expected current revision (null when new). Inputs are data, never scripts. See the root README and synthetic example inputs. No globally installed npm command is published.
