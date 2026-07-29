[CmdletBinding()]
param(
  [ValidateSet('http://127.0.0.1:8501')]
  [string]$ApiBaseUrl = 'http://127.0.0.1:8501',
  [ValidateRange(0, 120)]
  [int]$ImageWarmupSeconds = 60,
  [ValidateRange(3, 60)]
  [int]$ImageWarmupPollSeconds = 5
)

$ErrorActionPreference = 'Stop'
$origin = 'http://127.0.0.1:5173'
function Get-DeploymentSnapshot {
  $response = Invoke-WebRequest -UseBasicParsing -Uri "$ApiBaseUrl/api/health" -Headers @{ Origin = $origin } -TimeoutSec 20
  return [pscustomobject]@{ Response = $response; Health = ($response.Content | ConvertFrom-Json); Services = (Invoke-RestMethod -Uri "$ApiBaseUrl/api/services" -TimeoutSec 20) }
}

$initial = Get-DeploymentSnapshot
$current = $initial
$warmupAttempts = 0
$deadline = (Get-Date).AddSeconds($ImageWarmupSeconds)
while ($current.Health.status -ne 'ok' -and $ImageWarmupSeconds -gt 0 -and (Get-Date) -lt $deadline) {
  $remainingSeconds = [Math]::Ceiling(($deadline - (Get-Date)).TotalSeconds)
  if ($remainingSeconds -le 0) { break }
  Start-Sleep -Seconds ([Math]::Min($ImageWarmupPollSeconds, $remainingSeconds))
  $warmupAttempts++
  $current = Get-DeploymentSnapshot
}

$healthResponse = $current.Response
$health = $current.Health
$services = $current.Services
$benchmarks = Invoke-RestMethod -Uri "$ApiBaseUrl/api/benchmarks" -TimeoutSec 20
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8501 -ErrorAction Stop | Where-Object { $_.LocalAddress -in @('127.0.0.1', '::1') })

if ($healthResponse.StatusCode -ne 200 -or $healthResponse.Headers['access-control-allow-origin'] -ne $origin -or $health.status -ne 'ok') {
  throw 'Loopback health or CORS contract did not pass.'
}
if (-not $services.items -or -not ($benchmarks.items -is [System.Array])) {
  throw 'Read-only services or benchmark contract did not pass.'
}
if ($listeners.Count -eq 0) {
  throw 'No loopback listener was found on port 8501.'
}

[pscustomobject]@{
  Health = $health.status
  InitialHealth = $initial.Health.status
  WarmupAttempts = $warmupAttempts
  ServiceCount = @($services.items).Count
  BenchmarkCount = @($benchmarks.items).Count
  CorsOrigin = $healthResponse.Headers['access-control-allow-origin']
  LoopbackListeners = $listeners.Count
  Passed = $true
} | Format-List
