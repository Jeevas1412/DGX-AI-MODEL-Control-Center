[CmdletBinding()]
param(
  [string]$Root,
  [int]$MaxFileBytes = 10485760,
  [switch]$ReportOnly
)

if ([string]::IsNullOrWhiteSpace($Root)) {
  $scriptDirectory = Split-Path -Parent $PSCommandPath
  if ([string]::IsNullOrWhiteSpace($scriptDirectory)) {
    throw 'Unable to resolve the verification script directory. Pass -Root explicitly.'
  }
  $Root = Split-Path -Parent $scriptDirectory
}

$resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
$selfPath = $PSCommandPath
$publicIgnorePath = Join-Path $resolvedRoot '.public-tree-ignore'
$publicIgnorePatterns = if (Test-Path -LiteralPath $publicIgnorePath) {
  @(Get-Content -LiteralPath $publicIgnorePath -Encoding utf8 | ForEach-Object { $_.Trim().Replace('\', '/') } | Where-Object { $_ -and -not $_.StartsWith('#') })
} else { @() }
$blockedPathParts = @(
  '\\node_modules\\', '\\artifacts\\', '\\secrets\\', '\\.workbuddy\\',
  '\\backend\\data\\', '\\outputs\\', '\\semifinished\\', '\\downloads\\',
  '\\dist\\', '\\.vite\\', '\\coverage\\'
)
$blockedExtensions = @('.log', '.pid', '.partial', '.zip', '.7z', '.pfx', '.pem', '.key', '.token')
$contentPatterns = @(
  @{ Name = 'private-key'; Pattern = '-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----' },
  @{ Name = 'bearer-token'; Pattern = '(?i)Authorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+\-/=]+' },
  @{ Name = 'private-rfc1918-ip'; Pattern = '\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})\b' },
  @{ Name = 'windows-user-path'; Pattern = '(?i)[A-Z]:\\Users\\[^\\\s]+' },
  # A Windows absolute path is sensitive even when it names only one directory
  # (for example, D:\Project).  The old expression required a second trailing
  # separator and therefore missed this common form.
  @{ Name = 'absolute-windows-path'; Pattern = '(?i)\b[C-Z]:\\' }
)

$violations = [System.Collections.Generic.List[object]]::new()
$knownSafeContentExamples = @(
  @{ File = 'frontend/src/pages/Setup.tsx'; Rule = 'private-rfc1918-ip' },
  # These fixtures deliberately assert that unsafe profile values are rejected
  # and that OS-specific runtime paths are resolved correctly. They contain no
  # operator identity or usable credential.
  @{ File = 'backend/test/connection-profile.test.mjs'; Rule = 'absolute-windows-path' },
  @{ File = 'backend/test/runtime-paths.test.mjs'; Rule = 'absolute-windows-path' },
  @{ File = 'desktop/src/environment.test.mjs'; Rule = 'absolute-windows-path' },
  @{ File = 'frontend/src/pages/Setup.test.tsx'; Rule = 'private-rfc1918-ip' }
)
$excludedDirectoryNames = @('node_modules', 'artifacts', 'secrets', '.workbuddy', 'dist', '.vite', 'coverage', 'outputs', 'semifinished', 'downloads', 'data')
$directories = [System.Collections.Generic.Stack[System.IO.DirectoryInfo]]::new()
$directories.Push((Get-Item -LiteralPath $resolvedRoot))

function Test-PublicTreeIgnored([string]$RelativePath) {
  $normalised = $RelativePath.Replace('\', '/')
  foreach ($pattern in $publicIgnorePatterns) {
    if ($pattern.EndsWith('/')) {
      if ($normalised.StartsWith($pattern)) { return $true }
      continue
    }
    if ($pattern.StartsWith('*.')) {
      if ($normalised.EndsWith($pattern.Substring(1))) { return $true }
      continue
    }
    if (($pattern.Contains('*') -or $pattern.Contains('?')) -and $normalised -like $pattern) { return $true }
    if ($normalised -eq $pattern) { return $true }
  }
  return $false
}

while ($directories.Count -gt 0) {
  $directory = $directories.Pop()
  foreach ($entry in Get-ChildItem -LiteralPath $directory.FullName -Force) {
    if ($entry.PSIsContainer) {
      if ($excludedDirectoryNames -notcontains $entry.Name) { $directories.Push($entry) }
      continue
    }
    $file = $entry
    if ($file.FullName -eq $selfPath) { continue }
  $relative = $file.FullName.Substring($resolvedRoot.Length).TrimStart([char]92)
  $relativePolicy = $relative.Replace('\', '/')
  if (Test-PublicTreeIgnored $relative) { continue }
  $normalised = ([string][char]92) + $relative
  $normalised = $normalised.Replace('/', [char]92)
  $isBlockedPath = $false
  foreach ($blockedPart in $blockedPathParts) {
    if ($normalised -like "*$blockedPart*") {
      $isBlockedPath = $true
      break
    }
  }
  if ($isBlockedPath) {
    $violations.Add([pscustomobject]@{ File = $relative; Rule = 'blocked-path'; Detail = 'Generated or local-only path' })
    continue
  }
  if ($blockedExtensions -contains $file.Extension.ToLowerInvariant()) {
    $violations.Add([pscustomobject]@{ File = $relative; Rule = 'blocked-extension'; Detail = $file.Extension })
    continue
  }
  if ($file.Length -gt $MaxFileBytes) {
    $violations.Add([pscustomobject]@{ File = $relative; Rule = 'oversized-file'; Detail = "$($file.Length) bytes" })
    continue
  }
  if ($file.Extension.ToLowerInvariant() -notin @('.md', '.txt', '.json', '.yml', '.yaml', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.css', '.html', '.ps1')) { continue }
  $content = Get-Content -LiteralPath $file.FullName -Raw -Encoding utf8
  foreach ($rule in $contentPatterns) {
    if ($knownSafeContentExamples | Where-Object { $_.File -eq $relativePolicy -and $_.Rule -eq $rule.Name }) { continue }
    if ([regex]::IsMatch($content, $rule.Pattern)) {
      $violations.Add([pscustomobject]@{ File = $relative; Rule = $rule.Name; Detail = 'Content pattern matched' })
    }
  }
  }
}

if ($violations.Count -eq 0) {
  Write-Host 'Public tree verification passed: no blocked files or identity/credential patterns found.'
  exit 0
}

$violations | Sort-Object File, Rule | Format-Table -AutoSize
if ($ReportOnly) {
  Write-Warning "Public tree verification found $($violations.Count) issue(s). Keep local evidence outside the public repository or redact it before publishing."
  exit 0
}
Write-Error "Public tree verification found $($violations.Count) issue(s). Keep local evidence outside the public repository or redact it before publishing."
exit 1
