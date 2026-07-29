# DGX AI Control Center 1.0.0-rc.2

## Status

GitHub-only release candidate. This build is intentionally unsigned and is not the final `1.0.0` release.

## Included

- Production connection and setup UI now presents generic DGX monitoring and model-service control, without HY MT2 trial capability cards.
- A verified active OpenSSH profile can enable a remote management session; local model-service control remains an explicit, separately enabled preference.
- Model start, restart and stop retain fixed service/action pairs, capacity preflight, explicit confirmation, fixed remote adapters, postcondition verification and local audit records.

## Verification completed

- Backend tests: 85/85.
- Frontend lint and tests: passed, 85/85.
- Desktop tests and syntax check: passed, 17/17.
- Installer hash, SBOM and manifest are generated with the release artifact.

## Before final 1.0.0

Perform a user experience acceptance of the RC.2 upgrade, including verified connection, remote management session, explicit model-control preference, confirmation flow and an allowed service action. Then verify uninstall and rollback before manual promotion.
