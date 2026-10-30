param([Parameter(Mandatory=$true)][int]$OwnedProcessId,
      [Parameter(Mandatory=$true)][string]$DataDirectory)
$ErrorActionPreference = 'Stop'
try {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$OwnedProcessId"
  if ($owner.Name -ne 'postgres.exe' -or
      $owner.CommandLine.Replace('/','\').IndexOf($DataDirectory.Replace('/','\'), [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw 'The owned PostgreSQL process does not match its data directory.'
  }
  $identity = (Get-Process -Id $OwnedProcessId).StartTime.ToUniversalTime().Ticks
  $previous = @{}
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $last = $clock.Elapsed.TotalMilliseconds
  for ($frame = 0; $frame -lt 900; $frame++) {
    $root = Get-Process -Id $OwnedProcessId
    if ($root.StartTime.ToUniversalTime().Ticks -ne $identity) { throw 'Owned process identity changed.' }
    $owned = @(Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" |
      Where-Object { $_.ProcessId -eq $OwnedProcessId -or $_.ParentProcessId -eq $OwnedProcessId })
    $current = @{}
    $delta = 0.0
    foreach ($entry in $owned) {
      $process = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
      if ($null -eq $process) { continue }
      $key = "$($process.Id):$($process.StartTime.ToUniversalTime().Ticks)"
      $cpu = $process.TotalProcessorTime.TotalMilliseconds
      if ($previous.ContainsKey($key)) { $delta += [Math]::Max(0, $cpu - $previous[$key]) }
      $current[$key] = $cpu
    }
    $elapsed = $clock.Elapsed.TotalMilliseconds
    if ($frame -gt 0) {
      [Console]::WriteLine(([ordered]@{ version=1; sequence=$frame; cores=$delta/[Math]::Max(1,$elapsed-$last); processes=$current.Count } | ConvertTo-Json -Compress))
    }
    $previous = $current
    $last = $elapsed
    Start-Sleep -Milliseconds 1000
  }
} catch {
  [Console]::WriteLine('{"error":true}')
  exit 1
}
