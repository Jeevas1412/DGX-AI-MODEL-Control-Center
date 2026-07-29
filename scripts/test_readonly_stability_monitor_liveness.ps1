[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$OutputPath,
  [ValidateRange(1, 3600)]
  [int]$ExpectedIntervalSeconds = 300,
  [ValidateRange(0, 900)]
  [int]$GraceSeconds = 120,
  [int]$MonitorProcessId
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) {
  throw "Stability JSONL not found: $OutputPath"
}

$resolvedOutput = (Resolve-Path -LiteralPath $OutputPath).Path
$monitorScript = (Resolve-Path (Join-Path $PSScriptRoot 'test_readonly_service_stability.ps1')).Path
if ($MonitorProcessId) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $MonitorProcessId" -ErrorAction Stop
  if ($process.CommandLine -notmatch [regex]::Escape($monitorScript) -or $process.CommandLine -notmatch [regex]::Escape($resolvedOutput)) {
    throw "Process $MonitorProcessId is not the expected stability monitor."
  }
} else {
  $candidates = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'powershell.exe' -and $_.CommandLine -match [regex]::Escape($monitorScript) -and $_.CommandLine -match [regex]::Escape($resolvedOutput)
  })
  if ($candidates.Count -ne 1) {
    throw "Expected exactly one stability monitor process; found $($candidates.Count)."
  }
  $process = $candidates[0]
}

$lines = @(Get-Content -LiteralPath $resolvedOutput | Where-Object { $_.Trim() })
if ($lines.Count -eq 0) { throw 'Stability JSONL contains no samples.' }
$lastSample = $lines[-1] | ConvertFrom-Json
$lastAt = [DateTimeOffset]::Parse($lastSample.CheckedAt)
$ageSeconds = [Math]::Round(((Get-Date).ToUniversalTime() - $lastAt.UtcDateTime).TotalSeconds, 1)
$maxAgeSeconds = $ExpectedIntervalSeconds + $GraceSeconds
if ($ageSeconds -gt $maxAgeSeconds) {
  throw "Stability monitor sample is stale: $ageSeconds seconds old, maximum is $maxAgeSeconds."
}

[pscustomobject]@{
  ProcessId = $process.ProcessId
  LastSample = $lastSample.Sample
  LastSampleAt = $lastSample.CheckedAt
  SampleAgeSeconds = $ageSeconds
  MaximumAgeSeconds = $maxAgeSeconds
  LastPassed = $lastSample.Passed
  Passed = $true
} | Format-List
