# DGX AI Control Center 1.0.0-rc.1

## Status

GitHub-only release candidate. This build is intentionally unsigned and is not the final `1.0.0` release.

## Included

- Desktop Direct IPC runtime with isolated `development` / `test` / `staging` / `production` user-data namespaces.
- Setup wizard for alias-only OpenSSH profiles, fixed read-only verification and capability discovery.
- Read-only monitoring, controlled fixed service/HY plans, local operation ledger and recovery UI.
- Chinese/English, light/dark themes, tray and background-residency settings.

## Verification completed

- Backend tests: 85/85.
- Frontend lint and tests: passed, 85/85.
- Desktop tests and syntax check: passed, 17/17.
- Production dependency audit: 0 vulnerabilities.
- CycloneDX SBOM files generated for backend, frontend and desktop.
- Installer SHA-256: `1EC12907FD3E4EE7AF9A5BBE06FD73AEE520DA1102335D5F318EC0BD93270FC0`.
- GitHub Actions workflow committed for reproducible Windows build evidence; it has not yet run against a remote repository.

## Before final 1.0.0

Perform a clean install of this exact artifact, capture the first-run/Setup/Settings/tray flows, verify uninstall and rollback, then promote the same immutable artifact only after manual approval.
