$ErrorActionPreference = 'Continue'
$auditRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$auditDirectory = Join-Path $PSScriptRoot ('performance/phase27-audit/' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $auditDirectory -Force | Out-Null
$apiDirectory = Join-Path $auditRoot 'apps/api'
$steps = @(
  @{name='regressions'; tool='pnpm'; argv=@('test'); cwd=$auditRoot},
  @{name='lint'; tool='pnpm'; argv=@('lint'); cwd=$auditRoot},
  @{name='build'; tool='pnpm'; argv=@('--filter','api','build'); cwd=$auditRoot},
  @{name='web-build-local'; tool='pnpm'; argv=@('--filter','web','build:local'); cwd=$auditRoot},
  @{name='edge'; tool='pnpm'; argv=@('test:edge'); cwd=$auditRoot},
  @{name='hash-capacity'; tool='node'; argv=@('test/password-capacity.benchmark.mjs'); cwd=$apiDirectory},
  @{name='hash-flood'; tool='pnpm'; argv=@('--filter','api','test:hash-login-flood'); cwd=$auditRoot}
)
foreach ($mode in @('timeouts','idempotency','pooling','monitoring','indexing','tenants','caching','load','load-search','load-ramp','load-login-flood','load-menu-spike','load-order-burst','load-spike','load-soak-smoke','load-capacity')) {
  $steps += @{name=$mode; tool='node'; argv=@('test/request-timeouts.local-postgres.mjs',$mode); cwd=$apiDirectory}
}
$steps += @(
  @{name='realtime-identities'; tool='node'; argv=@('--test','test/realtime-fanout.identity.test.mjs'); cwd=$apiDirectory},
  @{name='realtime-local'; tool='node'; argv=@('test/realtime-fanout.mjs','local'); cwd=$apiDirectory},
  @{name='observability-flood'; tool='node'; argv=@('test/api-observability-flood.mjs'); cwd=$apiDirectory},
  @{name='failure-recovery'; tool='pnpm'; argv=@('test:failure-recovery'); cwd=$auditRoot},
  @{name='local-security-headers'; tool='pnpm'; argv=@('--filter','web','test:security-headers'); cwd=$auditRoot},
  @{name='secret-leaks'; tool='pnpm'; argv=@('test:leaks'); cwd=$auditRoot}
)
$results = @()
foreach ($step in $steps) {
  $started = [DateTime]::UtcNow
  Write-Output ('START ' + $step.name + ' ' + $started.ToString('o'))
  $log = Join-Path $auditDirectory ($step.name + '.log')
  Push-Location $step.cwd
  try {
    $commandArguments = $step.argv
    if ($step.tool -eq 'pnpm') { & pnpm @commandArguments *> $log } else { & node @commandArguments *> $log }
    $code = $LASTEXITCODE
  } catch { $_ | Out-File -FilePath $log -Append; $code = 1 }
  finally { Pop-Location }
  $finished = [DateTime]::UtcNow
  $results += @{name=$step.name; command=($step.tool + ' ' + ($step.argv -join ' ')); startedAt=$started.ToString('o'); finishedAt=$finished.ToString('o'); exitCode=$code; status=$(if ($code -eq 0) {'PASS'} else {'FAIL'}); log=$log}
  # Preserve each newly emitted summary before later suites can replace a latest-result file.
  $snapshot = Join-Path $auditDirectory $step.name
  New-Item -ItemType Directory -Path $snapshot -Force | Out-Null
  Get-ChildItem -LiteralPath (Join-Path $auditRoot 'artifacts/performance') -File -Filter '*.json' | Where-Object {$_.LastWriteTimeUtc -ge $started} | Copy-Item -Destination $snapshot
  $results | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $auditDirectory 'results.json') -Encoding UTF8
  Write-Output ('END ' + $step.name + ' exit=' + $code)
  if ($step.name -eq 'build' -and $code -ne 0) { break }
}
Write-Output ('REPORT ' + $auditDirectory)
if (@($results | Where-Object {$_.exitCode -ne 0}).Count -gt 0) { exit 1 }
