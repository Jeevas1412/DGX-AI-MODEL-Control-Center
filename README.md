# DGX AI Control Center

DGX AI Control Center is a Windows desktop application for operating a supported DGX environment through an existing Windows OpenSSH alias. It keeps connection setup, hardware visibility, model discovery, registered-service control, logs, and local audit records in one desktop interface.

The product is designed for environments where the DGX remains the source of truth. The app never accepts a private key, password, arbitrary shell command, path, or URL through its UI. It uses a selected and freshly verified connection profile together with fixed, versioned service adapters.

## What the application does

- **Connect and verify** — Save an OpenSSH alias locally, verify the intended DGX target and its supported capabilities, then make that verified profile the only target available to the application.
- **Monitor real state** — Display connection status, hardware telemetry, service status, logs, and local history without replacing unavailable data with mock values.
- **Discover local models** — Read only the model inventory declared by the verified target support profile. The app does not search public model registries or invent a model location.
- **Register a model service** — Create a local service configuration draft, validate the matching fixed adapter, check resource requirements, and register the service only after explicit review.
- **Control registered services** — For an adapter that has passed validation, create a bounded start/warmup, stop, or restart plan. Every action requires an in-app confirmation, executes only the registered fixed asset, then rechecks the resulting state.
- **Review model parameters** — Show adapter-declared parameters and bounded recommendations. A parameter change remains a planned, auditable action until the target adapter, resource checks, and confirmation requirements are satisfied.
- **Preserve operator awareness** — Show the target, impact, risk level, execution stage, and verification result before and during a protected operation. Creating a plan never starts a model by itself.

## Safety model

- No private keys, passwords, arbitrary remote commands, unrestricted shell access, or unbounded remote paths are accepted by the UI.
- A selected verified connection profile is required before monitoring or protected operations are available.
- A model is controllable only when its versioned fixed adapter has been validated against the connected target. Discovered models without a validated adapter remain visible but cannot be presented as loadable.
- Each high-impact operation follows **plan → explicit confirmation → fixed execution → postcondition verification → local audit**.
- The application does not automatically start, stop, restart, or replace model services.
- Generated installers, runtime data, logs, benchmark history, credentials, and deployment evidence are excluded from public Git history.

## Current status

This repository contains the `0.1.0` internal-test candidate. The main-branch GitHub validation workflow currently verifies the public-tree boundary, cross-layer quality gate, and production dependency audit.

It is **not a public release**. Public promotion remains blocked until a clean, persistent Windows 11 VM completes the required install, upgrade, uninstall, reinstall, and data-retention lifecycle acceptance, followed by final release review.

## Development checks

Install each component's locked dependencies, then run:

```powershell
npm ci --prefix backend
npm ci --prefix frontend
npm ci --prefix desktop
npm.cmd run check
npm audit --prefix <component> --omit=dev
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-public-tree.ps1
```

## Publication boundary

This project is licensed under Apache-2.0 and is distributed through GitHub only. Windows code signing is intentionally out of scope for this channel. When public release gates are complete, every installer must be accompanied by same-build SHA-256 checksums, SBOM files, release notes, and GitHub Actions evidence.
