param(
  [string]$RuntimeDirectory = (Join-Path $env:APPDATA 'DGX AI Control Center'),
  [switch]$ConfirmRecovery
)

$ErrorActionPreference = 'Stop'
$ledger = Join-Path $RuntimeDirectory 'control-operation-ledger.json'
$lock = "$ledger.lock"
if (-not (Test-Path -LiteralPath $lock -PathType Leaf)) { Write-Output 'No operation-ledger lock exists.'; exit 0 }
if (-not $ConfirmRecovery) { throw 'Review the stopped desktop process first, then rerun with -ConfirmRecovery. No lock was removed.' }
$first = Get-Item -LiteralPath $lock
$metadata = Get-Content -LiteralPath $lock -Raw -Encoding UTF8 | ConvertFrom-Json
if ($metadata.schemaVersion -ne 1 -or -not $metadata.nonce -or -not $metadata.pid) { throw 'Lock metadata is invalid; preserve it for manual investigation.' }
if (Get-Process -Id ([int]$metadata.pid) -ErrorAction SilentlyContinue) { throw "Lock owner PID $($metadata.pid) is still running." }
Start-Sleep -Milliseconds 300
$second = Get-Item -LiteralPath $lock
if ($first.Length -ne $second.Length -or $first.LastWriteTimeUtc -ne $second.LastWriteTimeUtc) { throw 'Lock changed during verification; no lock was removed.' }
$audit = Join-Path $RuntimeDirectory 'operation-ledger-lock-recovery.audit.jsonl'
$record = [ordered]@{ occurredAt = (Get-Date).ToUniversalTime().ToString('o'); action = 'remove-stale-lock'; lock = $lock; nonce = $metadata.nonce; pid = $metadata.pid; operator = $env:USERNAME } | ConvertTo-Json -Compress
Add-Content -LiteralPath $audit -Value $record -Encoding UTF8
Remove-Item -LiteralPath $lock -Force
Write-Output "Removed verified stale lock and wrote audit: $audit"
