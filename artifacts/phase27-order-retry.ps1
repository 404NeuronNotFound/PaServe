$ErrorActionPreference = 'Continue'
$auditRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$auditDirectory = Join-Path $auditRoot 'artifacts/performance/phase27-audit/20261101-004923'
$deadline = [DateTime]::UtcNow.AddMinutes(20)
do {
  $steps = Get-Content -LiteralPath (Join-Path $auditDirectory 'results.json') -Raw | ConvertFrom-Json
  if (@($steps | Where-Object {$_.name -eq 'secret-leaks'}).Count -gt 0) { break }
  if ([DateTime]::UtcNow -gt $deadline) { throw 'Previous sequential audit did not finish; no retry started.' }
  Start-Sleep -Seconds 3
} while ($true)
$destination = Join-Path $auditDirectory 'order-burst-retry'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$started = [DateTime]::UtcNow
Write-Output ('START stable-build order retry ' + $started.ToString('o'))
Push-Location (Join-Path $auditRoot 'apps/api')
try {
  & node test/request-timeouts.local-postgres.mjs load-order-burst *> (Join-Path $destination 'run.log')
  $code = $LASTEXITCODE
} finally { Pop-Location }
Get-ChildItem -LiteralPath (Join-Path $auditRoot 'artifacts/performance') -File -Filter '*.json' | Where-Object {$_.LastWriteTimeUtc -ge $started} | Copy-Item -Destination $destination
@{name='order-burst-retry'; exitCode=$code; startedAt=$started.ToString('o'); finishedAt=[DateTime]::UtcNow.ToString('o'); status=$(if ($code -eq 0) {'PASS'} else {'FAIL'}); command='node test/request-timeouts.local-postgres.mjs load-order-burst'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'result.json') -Encoding UTF8
Write-Output ('END stable-build order retry exit=' + $code)
exit $code
