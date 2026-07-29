[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$configPath = Join-Path $projectRoot 'secrets\lan-access.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw 'Enable protected LAN access before starting the LAN UI.' }
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($config.enabled -ne $true) { throw 'Protected LAN configuration is disabled.' }
$env:VITE_USE_MOCK_DATA = 'false'
$env:VITE_API_BASE_URL = "http://$($config.lanAddress):8501"
$vite = Join-Path $projectRoot 'frontend\node_modules\.bin\vite.cmd'
if (-not (Test-Path -LiteralPath $vite -PathType Leaf)) { throw 'Vite is not installed. Run npm.cmd install in frontend first.' }
Set-Location (Join-Path $projectRoot 'frontend')
& $vite --host 0.0.0.0 --port 5173 --strictPort
