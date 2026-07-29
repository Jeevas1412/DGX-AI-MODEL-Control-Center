[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$taskName = 'DGX-AI-Control-Center-ReadOnly'
$scriptPath = Join-Path $PSScriptRoot 'start_readonly_backend.ps1'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
  throw "Startup script not found: $scriptPath"
}

$userId = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State, @{ Name = 'AllowStartIfOnBatteries'; Expression = { $_.Settings.DisallowStartIfOnBatteries -eq $false } }, @{ Name = 'DontStopIfGoingOnBatteries'; Expression = { $_.Settings.StopIfGoingOnBatteries -eq $false } }, @{ Name = 'ExecutionTimeLimit'; Expression = { $_.Settings.ExecutionTimeLimit } }, @{ Name = 'RestartCount'; Expression = { $_.Settings.RestartCount } }, @{ Name = 'RestartInterval'; Expression = { $_.Settings.RestartInterval } } | Format-List
