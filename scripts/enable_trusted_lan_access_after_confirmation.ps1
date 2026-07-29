[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$LanAddress
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logPath = Join-Path $projectRoot 'artifacts\protected-lan-enable-attempt.log'

try {
  $candidate = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $LanAddress -ErrorAction Stop
  Set-NetConnectionProfile -InterfaceIndex $candidate.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
  & (Join-Path $PSScriptRoot 'enable_protected_lan_access.ps1') -LanAddress $LanAddress
  [IO.File]::WriteAllText($logPath, "SUCCESS $(Get-Date -Format o)`n", [Text.UTF8Encoding]::new($false))
} catch {
  [IO.File]::WriteAllText($logPath, (($_ | Out-String) + "`n"), [Text.UTF8Encoding]::new($false))
  throw
}
