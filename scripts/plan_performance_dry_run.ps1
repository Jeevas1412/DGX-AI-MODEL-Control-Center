[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$PlanPath
)

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$planRoot = Join-Path $workspaceRoot 'artifacts\performance-plans'
$auditPath = Join-Path $workspaceRoot 'artifacts\performance-audits\dry-run-audit.jsonl'
if (-not (Test-Path -LiteralPath $PlanPath -PathType Leaf)) { throw "Local performance plan does not exist: $PlanPath" }

$resolvedPlan = (Resolve-Path -LiteralPath $PlanPath).Path
$resolvedPlanRoot = [System.IO.Path]::GetFullPath($planRoot)
$comparison = [System.StringComparison]::OrdinalIgnoreCase
if (-not $resolvedPlan.EndsWith('.json', $comparison) -or -not $resolvedPlan.StartsWith($resolvedPlanRoot + [System.IO.Path]::DirectorySeparatorChar, $comparison)) {
  throw "PlanPath must be a JSON plan below $planRoot"
}

$node = Get-Command node.exe -ErrorAction Stop
& $node.Source (Join-Path $workspaceRoot 'backend\src\performance-dry-run-cli.mjs') --plan $resolvedPlan --audit $auditPath
if ($LASTEXITCODE -ne 0) { throw "Performance dry-run failed with exit code $LASTEXITCODE." }
