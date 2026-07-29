[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$InputPath
)

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$resultRoot = Join-Path $workspaceRoot 'artifacts\benchmark-results'
$historyPath = Join-Path $workspaceRoot 'backend\data\benchmark-history.jsonl'

if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
  throw "Local benchmark result file does not exist: $InputPath"
}

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$resolvedResultRoot = [System.IO.Path]::GetFullPath($resultRoot)
$comparison = [System.StringComparison]::OrdinalIgnoreCase
if (-not $resolvedInput.EndsWith('.json', $comparison) -or -not $resolvedInput.StartsWith($resolvedResultRoot + [System.IO.Path]::DirectorySeparatorChar, $comparison)) {
  throw "InputPath must be a JSON result below $resultRoot"
}

$node = Get-Command node.exe -ErrorAction Stop
& $node.Source (Join-Path $workspaceRoot 'backend\src\benchmark-history-cli.mjs') --input $resolvedInput --history $historyPath
if ($LASTEXITCODE -ne 0) {
  throw "Benchmark history append failed with exit code $LASTEXITCODE."
}
