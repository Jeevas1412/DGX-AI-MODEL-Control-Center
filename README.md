# DGX AI Control Center

DGX AI Control Center is a Windows desktop control plane for connecting to a supported DGX environment through an existing Windows OpenSSH alias. It is being prepared as a safe, installable product: the desktop renderer has no Node, shell, SSH-key or token access; all remote access remains in the local backend behind fixed contracts.

## Current status

This repository is preparing the `0.1.0` internal-test candidate. It is not a public release and must not be promoted until the GitHub workflow, clean-VM lifecycle acceptance and final release review are complete.

## Product safety principles

- No private keys, passwords, arbitrary remote commands or unrestricted shell access in the UI.
- A selected, verified connection profile must become the only remote target before any monitoring or protected action is available.
- Unknown deployments remain diagnostic/read-only; fixed adapters define all supported control actions.
- High-impact operations follow plan, explicit confirmation, execution, verification and audit.
- Generated artifacts, logs, benchmark data, credentials and local deployment evidence do not belong in public Git history.

## Development entry points

Use the root quality gate after installing each component's locked dependencies:

- `npm ci --prefix backend`, `npm ci --prefix frontend`, `npm ci --prefix desktop`
- `npm.cmd run check`: backend, frontend and desktop cross-layer quality gate.
- `npm audit --prefix <component> --omit=dev`: production dependency audit.
- `scripts/verify-public-tree.ps1`: pre-publication denylist and identity-pattern scan.

## Before publishing

Run `scripts/verify-public-tree.ps1` before staging any files. This project is licensed under Apache-2.0 and distributed through GitHub only. Windows code signing is intentionally out of scope for this channel; every published installer must instead be accompanied by its same-build SHA-256 manifest, SBOM files, release notes and GitHub Actions evidence. A clean Windows 11 VM install, upgrade, uninstall and data-retention acceptance record remains required before any public promotion.
