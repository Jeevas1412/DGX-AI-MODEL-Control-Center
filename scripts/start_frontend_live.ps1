[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$env:VITE_USE_MOCK_DATA = 'false'
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8501'

Set-Location (Join-Path $PSScriptRoot '..\frontend')
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
