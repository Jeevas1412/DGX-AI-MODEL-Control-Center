#requires -RunAsAdministrator
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# This deliberately targets only the DGX AI Control Center test runtime state.
# It never removes the archive or any OpenSSH profile/key material.
$taskNames = @(
  'DGX-AI-Control-Center-LanUI',
  'DGX-AI-Control-Center-ReadOnly'
)
$ruleNames = @(
  'DGX AI Control Center - Protected LAN API',
  'DGX AI Control Center - Protected LAN UI'
)
$userState = Join-Path $env:APPDATA 'dgx-ai-control-center-desktop'

foreach ($taskName in $taskNames) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -ne $task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
}

foreach ($ruleName in $ruleNames) {
  Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}

if (Test-Path -LiteralPath $userState) {
  Remove-Item -LiteralPath $userState -Recurse -Force
}

Write-Host 'Archived test runtime state has been removed. The release workspace and archive were not touched.' -ForegroundColor Green
