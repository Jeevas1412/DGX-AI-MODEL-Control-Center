# DGX AI Control Center 0.2.0

Status: development candidate (not promoted, not installed as the formal production build). This file is release input for the internal candidate workflow; it does not announce a public release.

## Artifact

- Installer: `release-021-final\DGX AI Control Center Setup 0.2.0.exe`
- SHA-256: `a7e5912ff91278a20ee187b414d1da53ac2ddba6c8d2f88047b2393cbe499966`
- Built 2026-08-05 from the isolated `开发版0.2.0` environment (electronDist custom unpack, unsigned internal channel). Revision 2 fixes the desktop IPC allowlist so the read-only dual-node routes (`GET /api/nodes`, `GET /api/nodes/:profileId`) are reachable through the packaged Electron bridge.

## Scope

- Windows Electron desktop application with Chinese and English UI, theme preference, tray/background behaviour and desktop/start-menu shortcuts.
- Connection setup based on existing Windows OpenSSH aliases. The application does not collect private keys, passwords or arbitrary SSH commands.
- Read-only DGX monitoring, hardware telemetry, logs and connection-status indication after the user verifies an active profile.
- **New in 0.2.0 — read-only dual-node overview (B-lite):**
  - Connection profile schema v4 adds `monitoredProfileIds` (read-only monitor scope) while `activeProfileId` stays a scalar; the single-node operation model and its security boundary are unchanged. Schema-3 documents migrate losslessly (verification evidence preserved); schema-1/2 still migrate fail-closed and require fresh verification.
  - `GET /api/nodes` aggregates every verified profile in parallel (`Promise.allSettled`, partial-success: one node timing out never fails the response) with a four-state status (`healthy` / `degraded` / `unreachable` / `unknown`) and per-node error classification. `GET /api/nodes/:profileId` returns a single-node snapshot; the overview never carries full logs.
  - Overview page adds a dual-node card grid (hostname, SSH alias, status badge, GPU, driver, unified memory, service counts, collection time, interconnect and vLLM lines). Clicking a card switches the active operation node; detail and write operations always target the single active node.
  - Interconnect read-only probe: cluster interface `enp1s0f1np1` state/MTU, RDMA link state, RoCEv2 GID index 3, RX/TX and error/drop counters, peer reachability (fixed Spark pair cluster-address ICMP probe — no bandwidth test on refresh).
  - vLLM service-layer summary: discovered vLLM runtime ports probed with `/healthz` and `/v1/models` (PROCESS_UP / API_READY layering; the synthetic inference probe remains a low-frequency follow-up task and is never run on front-end refresh).

## Requirements

- Windows 11 x64.
- Windows OpenSSH client configured by the user with aliases for supported DGX targets.
- Network access from the Windows computer to each target. The application starts unconfigured and does not embed a target address, model inventory or credential.

## Security and known limitations

- The installer is intentionally unsigned for the internal channel. Verify the same-build SHA-256 before installation.
- Dual-node overview is strictly read-only aggregation. No batch command, cross-node service control or auto-discovery is included in 0.2.0.
- Model loading, stopping, restart and parameter changes remain user-confirmed single-node operations and may be blocked by target verification, queue or resource checks.
- A persistent clean Windows 11 VM must still validate install, upgrade, uninstall, reinstall and retained-data behaviour before promotion.

## Candidate evidence

The installer, checksum and release manifest are produced from the isolated `开发版0.2.0` environment. Promotion to production requires: single immutable artifact (same SHA-256), manual confirmation, and shortcut/install updates per the version-governance runbook.
