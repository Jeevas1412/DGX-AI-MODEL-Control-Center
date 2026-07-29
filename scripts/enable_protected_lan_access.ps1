[CmdletBinding()]
param(
  [string]$LanAddress
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$secretsDirectory = Join-Path $projectRoot 'secrets'
$configPath = Join-Path $secretsDirectory 'lan-access.json'
$tokenPath = Join-Path $secretsDirectory 'lan-access.token'
$apiRuleName = 'DGX AI Control Center - Protected LAN API'
$frontendRuleName = 'DGX AI Control Center - Protected LAN UI'
$taskName = 'DGX-AI-Control-Center-ReadOnly'

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-PrivateIpv4([string]$Value) {
  return $Value -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)'
}

if (-not (Test-IsAdministrator)) {
  throw 'Run this script from an elevated PowerShell window. The firewall must be configured before LAN listening is enabled.'
}

if (-not $LanAddress) {
  $candidate = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.AddressState -eq 'Preferred' -and (Test-PrivateIpv4 $_.IPAddress)
  } | Select-Object -First 1
  if (-not $candidate) { throw 'No private IPv4 address was found. Refusing LAN exposure.' }
  $LanAddress = $candidate.IPAddress
  $interfaceIndex = $candidate.InterfaceIndex
} else {
  if (-not (Test-PrivateIpv4 $LanAddress)) { throw 'LanAddress must be an RFC1918 private IPv4 address.' }
  $candidate = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $LanAddress -ErrorAction Stop
  $interfaceIndex = $candidate.InterfaceIndex
}

$profile = Get-NetConnectionProfile -InterfaceIndex $interfaceIndex -ErrorAction Stop
if ($profile.NetworkCategory -ne 'Private') {
  throw "The selected network profile is '$($profile.NetworkCategory)'. Mark the trusted LAN as Private before enabling exposure."
}

New-Item -ItemType Directory -Path $secretsDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
  $bytes = [byte[]]::new(32)
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  [IO.File]::WriteAllText($tokenPath, "$token`n", [Text.UTF8Encoding]::new($false))
  $acl = [Security.AccessControl.FileSecurity]::new()
  $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($account, 'FullControl', 'Allow'))
  Set-Acl -LiteralPath $tokenPath -AclObject $acl
}

$token = (Get-Content -LiteralPath $tokenPath -Raw -Encoding UTF8).Trim()
if ($token -notmatch '^[A-Za-z0-9_-]{43,128}$') { throw 'Existing LAN API token is invalid.' }

foreach ($ruleName in @($apiRuleName, $frontendRuleName)) {
  Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

try {
  New-NetFirewallRule -DisplayName $apiRuleName -Group 'DGX AI Control Center' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8501 -RemoteAddress LocalSubnet -Profile Private -Description 'Read-only API; bearer token required.' | Out-Null
  New-NetFirewallRule -DisplayName $frontendRuleName -Group 'DGX AI Control Center' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -RemoteAddress LocalSubnet -Profile Private -Description 'Local Vite UI; API remains bearer-token protected.' | Out-Null
  $config = [ordered]@{ enabled = $true; lanAddress = $LanAddress; enabledAt = (Get-Date).ToString('o') } | ConvertTo-Json
  $tempPath = "$configPath.tmp"
  [IO.File]::WriteAllText($tempPath, "$config`n", [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $tempPath -Destination $configPath -Force
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 3
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8501/api/health' -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 20
  if ($health.status -notin @('ok', 'healthy', 'degraded')) { throw 'Protected backend health response was not recognized.' }
} catch {
  Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
  foreach ($ruleName in @($apiRuleName, $frontendRuleName)) {
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  }
  Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  throw
}

Write-Host 'Protected LAN access is enabled. Run show_protected_lan_access.ps1 -RevealToken only on a trusted machine to retrieve the session token.'
