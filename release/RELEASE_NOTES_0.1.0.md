# DGX AI Control Center 0.1.0

Status: internal-test candidate. This file is release input for the GitHub Actions candidate workflow; it does not announce a public release.

## Scope

- Windows Electron desktop application with Chinese and English UI, theme preference, tray/background behaviour and desktop/start-menu shortcuts.
- Connection setup based on an existing Windows OpenSSH alias. The application does not collect private keys, passwords or arbitrary SSH commands.
- Read-only DGX monitoring, hardware telemetry, logs and connection-status indication after the user verifies an active profile.
- Supported model management through fixed, versioned service adapters only. A model action always requires a fresh verified target, plan, explicit confirmation, fixed execution and postcondition verification.
- The candidate contains no model-specific adapter package, model directory, target address or remote startup script. A discovered model remains non-controllable until its target already provides a reviewed, compatible fixed adapter.

## Requirements

- Windows 11 x64.
- Windows OpenSSH client configured by the user with an alias for a supported DGX target.
- Network access from the Windows computer to that target. The application starts unconfigured and does not embed a target address, model inventory or credential.

## Security and known limitations

- The installer is intentionally unsigned for the GitHub-only channel. Verify the same-build `SHA256SUMS.txt` before installation.
- A verified adapter represents only a declared supported deployment; it is not a universal promise that every DGX model can be started.
- Model loading, stopping, restart and parameter changes are not automatic. They remain user-confirmed operations and may be blocked by target verification, queue or resource checks.
- A persistent clean Windows 11 VM must still validate install, upgrade, uninstall, reinstall and retained-data behaviour before a GitHub Draft/Prerelease can be promoted.

## Candidate evidence

GitHub Actions creates the installer, checksum, CycloneDX SBOMs, release manifest and blockmap from one source commit. The workflow refuses to create a tag candidate when the tag does not equal `v0.1.0`, when versions disagree, or when the public-tree, quality or production-dependency gates fail.

## Historical material boundary

Earlier `1.0.0-rc.*` release notes, manifests and SBOMs remain in this repository for traceability only. See `release/HISTORY.md`; those files are not evidence or downloadable assets for this `0.1.0` candidate.
