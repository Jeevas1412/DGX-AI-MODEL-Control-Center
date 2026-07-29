[CmdletBinding()]
param(
  [switch]$RevealToken
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$configPath = Join-Path $projectRoot 'secrets\lan-access.json'
$tokenPath = Join-Path $projectRoot 'secrets\lan-access.token'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw 'Protected LAN access is not enabled.' }
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host "UI address: http://$($config.lanAddress):5173/"
Write-Host 'Open the UI, then enter the token in Settings > 局域网 API 访问令牌.'
if ($RevealToken) {
  Write-Output ((Get-Content -LiteralPath $tokenPath -Raw -Encoding UTF8).Trim())
}
