[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$configPath = Join-Path $projectRoot 'secrets\lan-access.json'
$taskName = 'DGX-AI-Control-Center-ReadOnly'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdministrator = ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdministrator) { throw 'Run this script from an elevated PowerShell window to remove LAN firewall rules.' }

Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
foreach ($ruleName in @('DGX AI Control Center - Protected LAN API', 'DGX AI Control Center - Protected LAN UI')) {
  Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
}
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $taskName
Write-Host 'Protected LAN access is disabled. The backend has returned to loopback-only mode. The token file was retained for future re-enable operations.'
