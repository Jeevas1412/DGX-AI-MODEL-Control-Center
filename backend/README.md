# DGX AI Control Center — Read-only API

This service exposes the planned monitoring endpoints without any write, shell, Docker, or SSH capability.

## Run locally

Requires Node.js 22 or later.

```powershell
cd <project-root>\backend
npm test
npm start
```

For a local backend process, run the workspace helper in a PowerShell window and keep that window open:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File <project-root>\scripts\start_readonly_backend.ps1
```

By default it binds only to `127.0.0.1:8501`. It does not select an SSH target or load a target support package.

It listens on `127.0.0.1:8501` by default. Set `CONTROL_CENTER_HOST` and `CONTROL_CENTER_PORT` explicitly when deployment requires a different bind address or port.

When the Vite development UI is on a different local port, set `CONTROL_CENTER_CORS_ORIGINS` to a comma-separated allowlist of exact private or loopback origins. The API never uses a wildcard. A non-loopback listener requires `CONTROL_CENTER_API_TOKEN`; every API request must then carry it as `Authorization: Bearer <token>`.

For the supported, reversible Windows deployment workflow, use [the protected LAN access runbook](../docs/protected-lan-access-runbook.md). It requires an elevated PowerShell window and a Windows **Private** network profile before the backend can listen beyond loopback.

## Enable target monitoring

The service is safe by default and starts with placeholder data. Enable read-only collection explicitly in the same PowerShell session, then create, verify and activate an OpenSSH-alias connection through the Setup UI:

```powershell
$env:DGX_READ_ONLY_ENABLED = 'true'
npm.cmd start
```

The collector sends fixed read-only probes through the verified alias. A target support package determines which already reviewed local model directories, service health checks and log streams exist on that target. It does not expose an SSH command endpoint, and it cannot start, stop, restart or reconfigure a remote service merely because monitoring is enabled. Snapshot data is cached for 2.5 seconds by default (`DGX_SNAPSHOT_CACHE_MS`, 500–30000 ms).

`/api/logs` is available only after a verified target support package declares a fixed log asset. It bounds output to 500 lines and redacts common credential forms before returning it.

## Available endpoints

- `GET /api/health`
- `GET /api/services`
- `GET /api/system`
- `GET /api/requests`
- `GET /api/logs?service=<supported-service-id>&lines=200`
- `GET /api/benchmarks`

Performance history is a local append-only JSONL record; it has no HTTP write endpoint. See [the local persistence design](../docs/benchmark-history-persistence-design.md) for the restricted, local-only result import contract.

When collection is disabled or unavailable, the current snapshot provider intentionally returns `unknown` or `null` values. This makes the unavailable state explicit instead of inventing operational data.

## Collector integration boundary

The target collector lives in `src/dgx-collector.mjs`. Any future source must preserve the existing rules: a verified support-package declaration only, no arbitrary command execution, and no write operation.
