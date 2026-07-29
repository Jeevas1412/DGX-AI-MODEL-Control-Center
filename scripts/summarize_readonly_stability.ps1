[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$InputPath,
  [ValidateRange(1, 100000)]
  [int]$ExpectedSamples = 288,
  [switch]$RequireComplete,
  [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
  throw "Stability log not found: $InputPath"
}

$samples = @(Get-Content -LiteralPath $InputPath | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
if ($samples.Count -eq 0) { throw 'Stability log contains no samples.' }

$failed = @($samples | Where-Object { -not $_.Passed })
$initialImageOffline = @($samples | Where-Object { $_.PSObject.Properties['InitialImageStatus'] -and $_.InitialImageStatus -ne 'running' })
$warmupRecovered = @($samples | Where-Object { $_.PSObject.Properties['ImageWarmupRecovered'] -and $_.ImageWarmupRecovered })
$warmupAttempts = @($samples | ForEach-Object { if ($_.PSObject.Properties['ImageWarmupAttempts']) { [int]$_.ImageWarmupAttempts } else { 0 } })
$warmupElapsed = @($samples | ForEach-Object { if ($_.PSObject.Properties['WarmupElapsedSeconds']) { [double]$_.WarmupElapsedSeconds } else { 0 } })
$hasWarmupElapsed = @($samples | Where-Object { $_.PSObject.Properties['WarmupElapsedSeconds'] }).Count -gt 0

$summary = [pscustomobject]@{
  ExpectedSamples = $ExpectedSamples
  RecordedSamples = $samples.Count
  PassedSamples = $samples.Count - $failed.Count
  FailedSamples = $failed.Count
  Complete = $samples.Count -ge $ExpectedSamples
  FirstSampleAt = $samples[0].CheckedAt
  LastSampleAt = $samples[-1].CheckedAt
  LastHealth = $samples[-1].Health
  LastServices = $samples[-1].Services
  InitialImageOfflineSamples = $initialImageOffline.Count
  WarmupRecoveredSamples = $warmupRecovered.Count
  MaxWarmupAttempts = ($warmupAttempts | Measure-Object -Maximum).Maximum
  MaxWarmupElapsedSeconds = if ($hasWarmupElapsed) { ($warmupElapsed | Measure-Object -Maximum).Maximum } else { $null }
}

$summary | Format-List
if ($ReportPath) {
  $reportDirectory = Split-Path -Parent $ReportPath
  if ($reportDirectory) { New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null }
  $report = @(
    '# Local Read-only Stability Summary',
    '',
    "- GeneratedAt: $((Get-Date).ToString('o'))",
    "- Samples: $($summary.RecordedSamples)/$($summary.ExpectedSamples); Passed: $($summary.PassedSamples); Failed: $($summary.FailedSamples); Complete: $($summary.Complete)",
    "- InitialImageOffline: $($summary.InitialImageOfflineSamples); WarmupRecovered: $($summary.WarmupRecoveredSamples)",
    "- MaxWarmupAttempts: $($summary.MaxWarmupAttempts); MaxRecordedWarmupElapsedSeconds: $($summary.MaxWarmupElapsedSeconds)",
    "- SampleWindow: $($summary.FirstSampleAt) to $($summary.LastSampleAt)",
    "- LastStatus: health=$($summary.LastHealth); services=$($summary.LastServices)"
  )
  Set-Content -LiteralPath $ReportPath -Value ($report -join [Environment]::NewLine) -Encoding utf8
  "Stability report written to $ReportPath"
}

if ($failed.Count -gt 0) {
  $failed | Select-Object Sample, CheckedAt, Health, Error | Format-Table -AutoSize
  throw "Stability log contains $($failed.Count) failed sample(s)."
}
if ($RequireComplete -and -not $summary.Complete) {
  throw "Stability log is incomplete: $($summary.RecordedSamples)/$ExpectedSamples samples."
}

'Stability log summary passed.'
