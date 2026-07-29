[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$env:DGX_READ_ONLY_ENABLED = 'true'
# Generic model/service control remains disabled unless the local user enables
# a verified fixed adapter through the product workflow.
$env:DGX_LOCAL_CONTROL_ENABLED = 'false'
# An SSH target is never supplied by the launcher. The product binds only a
# user-created, verified OpenSSH-alias profile through its Setup UI.
$env:DGX_SSH_TARGET = ''
$env:CONTROL_CENTER_PORT = '8501'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$lanConfigPath = Join-Path $projectRoot 'secrets\lan-access.json'

if (Test-Path -LiteralPath $lanConfigPath -PathType Leaf) {
  $lanConfig = Get-Content -LiteralPath $lanConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($lanConfig.enabled -ne $true -or $lanConfig.lanAddress -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)') {
    throw 'LAN configuration is invalid. Remove it with the protected LAN disable script before starting again.'
  }
  $tokenPath = Join-Path $projectRoot 'secrets\lan-access.token'
  if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
    throw 'Protected LAN API token is missing. Refusing to listen on the LAN.'
  }
  $token = (Get-Content -LiteralPath $tokenPath -Raw -Encoding UTF8).Trim()
  if ($token -notmatch '^[A-Za-z0-9_-]{43,128}$') {
    throw 'Protected LAN API token is invalid. Refusing to listen on the LAN.'
  }
  $env:CONTROL_CENTER_HOST = '0.0.0.0'
  $env:CONTROL_CENTER_API_TOKEN = $token
  $env:CONTROL_CENTER_CORS_ORIGINS = "http://127.0.0.1:5173,http://$($lanConfig.lanAddress):5173"
} else {
  $env:CONTROL_CENTER_HOST = '127.0.0.1'
  $env:CONTROL_CENTER_API_TOKEN = ''
  $env:CONTROL_CENTER_CORS_ORIGINS = 'http://127.0.0.1:5173'
}

Set-Location (Join-Path $PSScriptRoot '..\backend')
node src/server.mjs
