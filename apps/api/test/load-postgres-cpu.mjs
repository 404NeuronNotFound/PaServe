import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function postgresCpuCollector(pid, directory) {
  assert.equal(
    process.platform,
    'win32',
    'This local capacity profile requires the Windows owned-process CPU collector.',
  );
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const child = spawn(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      fileURLToPath(new URL('./load-postgres-cpu.ps1', import.meta.url)),
      '-OwnedProcessId',
      String(pid),
      '-DataDirectory',
      directory,
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  let buffer = '',
    latest,
    healthy = true,
    stopped = false;
  child.on('error', () => {
    healthy = false;
  });
  child.on('exit', () => {
    if (!stopped) healthy = false;
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 4096) {
      healthy = false;
      child.kill();
      return;
    }
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index < 0) break;
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try {
        const value = JSON.parse(line);
        if (
          value.version !== 1 ||
          !Number.isFinite(value.cores) ||
          value.cores < 0 ||
          !Number.isInteger(value.processes) ||
          value.processes < 1 ||
          !Number.isInteger(value.sequence) ||
          value.sequence <= (latest?.sequence ?? 0)
        )
          throw new Error();
        latest = { ...value, at: performance.now() };
      } catch {
        healthy = false;
      }
    }
  });
  return {
    snapshot: () => ({
      source: 'owned PostgreSQL process tree; one-second Windows CPU samples',
      healthy: healthy && !!latest,
      cores: latest?.cores ?? null,
      ageMs: latest ? performance.now() - latest.at : null,
      processes: latest?.processes ?? null,
    }),
    stop: () => {
      stopped = true;
      child.kill();
    },
  };
}
