[CmdletBinding()]
param(
  [ValidateRange(1, 100000)]
  [int]$SampleCount = 3,
  [ValidateRange(1, 3600)]
  [int]$IntervalSeconds = 15,
  [ValidateSet('http://127.0.0.1:8501')]
  [string]$ApiBaseUrl = 'http://127.0.0.1:8501',
  [ValidateRange(0, 120)]
  [int]$ImageWarmupSeconds = 0,
  [ValidateRange(3, 60)]
  [int]$ImageWarmupPollSeconds = 5,
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$origin = 'http://127.0.0.1:5173'
$results = [System.Collections.Generic.List[object]]::new()

if ($OutputPath) {
  $outputDirectory = Split-Path -Parent $OutputPath
  if ($outputDirectory) { New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null }
  Set-Content -LiteralPath $OutputPath -Value '' -Encoding utf8
}

function Write-SampleLog([object]$Sample) {
  if ($OutputPath) {
    $Sample | ConvertTo-Json -Compress -Depth 4 | Add-Content -LiteralPath $OutputPath -Encoding utf8
  }
}

function Get-ReadOnlySnapshot {
  $healthResponse = Invoke-WebRequest -UseBasicParsing -Uri "$ApiBaseUrl/api/health" -Headers @{ Origin = $origin } -TimeoutSec 20
  $health = $healthResponse.Content | ConvertFrom-Json
  $services = Invoke-RestMethod -Uri "$ApiBaseUrl/api/services" -TimeoutSec 20
  $serviceSummary = @($services.items | ForEach-Object { "$($_.id)=$($_.status)" }) -join ','
  $image = $services.items | Where-Object { $_.id -eq 'image' } | Select-Object -First 1
  return [pscustomobject]@{
    HttpStatus = $healthResponse.StatusCode
    CorsOrigin = $healthResponse.Headers['access-control-allow-origin']
    Health = $health.status
    Services = $serviceSummary
    ImageStatus = if ($image) { $image.status } else { 'unknown' }
  }
}

for ($index = 1; $index -le $SampleCount; $index++) {
  $checkedAt = (Get-Date).ToString('o')
  try {
    $initial = Get-ReadOnlySnapshot
    $current = $initial
    $warmupAttempts = 0
    $warmupStartedAt = Get-Date
    $deadline = (Get-Date).AddSeconds($ImageWarmupSeconds)
    while ($ImageWarmupSeconds -gt 0 -and $current.ImageStatus -ne 'running' -and (Get-Date) -lt $deadline) {
      $remainingSeconds = [Math]::Ceiling(($deadline - (Get-Date)).TotalSeconds)
      if ($remainingSeconds -le 0) { break }
      Start-Sleep -Seconds ([Math]::Min($ImageWarmupPollSeconds, $remainingSeconds))
      $warmupAttempts++
      $current = Get-ReadOnlySnapshot
    }
    $sample = [pscustomobject]@{
      Sample = $index
      CheckedAt = $checkedAt
      HttpStatus = $current.HttpStatus
      CorsOrigin = $current.CorsOrigin
      Health = $current.Health
      Services = $current.Services
      InitialHealth = $initial.Health
      InitialImageStatus = $initial.ImageStatus
      ImageWarmupSeconds = $ImageWarmupSeconds
      ImageWarmupPollSeconds = $ImageWarmupPollSeconds
      ImageWarmupAttempts = $warmupAttempts
      WarmupElapsedSeconds = [Math]::Round(((Get-Date) - $warmupStartedAt).TotalSeconds, 3)
      ImageWarmupRecovered = $initial.ImageStatus -ne 'running' -and $current.ImageStatus -eq 'running'
      Passed = $current.HttpStatus -eq 200 -and $current.CorsOrigin -eq $origin -and $current.Health -eq 'ok'
      Error = $null
    }
    $results.Add($sample)
    Write-SampleLog $sample
  } catch {
    $sample = [pscustomobject]@{
      Sample = $index
      CheckedAt = $checkedAt
      HttpStatus = $null
      CorsOrigin = $null
      Health = 'unreachable'
      Services = $null
      InitialHealth = 'unreachable'
      InitialImageStatus = 'unknown'
      ImageWarmupSeconds = $ImageWarmupSeconds
      ImageWarmupPollSeconds = $ImageWarmupPollSeconds
      ImageWarmupAttempts = 0
      WarmupElapsedSeconds = 0
      ImageWarmupRecovered = $false
      Passed = $false
      Error = $_.Exception.Message
    }
    $results.Add($sample)
    Write-SampleLog $sample
  }

  if ($index -lt $SampleCount) { Start-Sleep -Seconds $IntervalSeconds }
}

$results | Format-Table -AutoSize
$failed = @($results | Where-Object { -not $_.Passed })
if ($failed.Count -gt 0) {
  throw "Read-only stability check failed: $($failed.Count)/$SampleCount sample(s) did not meet the loopback health contract."
}

"Read-only stability check passed: $SampleCount/$SampleCount samples, health=ok, CORS=$origin."
