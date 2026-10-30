import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';

// Retain counts only: no messages, credentials, SQL, stack traces or per-event arrays.
export function soakLogs() {
  const counts = { warn: 0, error: 0, fatal: 0, processWarning: 0 };
  let baseline = { ...counts };
  let begun = false;
  const warningTypes = [];
  const logger = {
    log() {},
    debug() {},
    verbose() {},
    warn: () => {
      counts.warn++;
    },
    error: () => {
      counts.error++;
    },
    fatal: () => {
      counts.fatal++;
    },
  };
  const warning = (event) => {
    counts.processWarning++;
    if (warningTypes.length < 4)
      warningTypes.push({
        name: /^[A-Za-z]+$/u.test(event?.name ?? '') ? event.name : 'Unknown',
        code: /^[A-Z0-9_]+$/u.test(event?.code ?? '') ? event.code : 'Unknown',
      });
  };
  const original = { warn: console.warn, error: console.error };
  let installed = false;
  return {
    logger,
    snapshot: () => ({
      enabled: true,
      ...Object.fromEntries(
        Object.entries(counts).map(([key, value]) => [
          key,
          value - baseline[key],
        ]),
      ),
    }),
    begin() {
      if (begun) throw new Error('Measured log baseline already established.');
      begun = true;
      const setup = { ...counts, warningTypes: [...warningTypes] };
      baseline = { ...counts };
      return setup;
    },
    install() {
      if (installed) throw new Error('Log capture already installed.');
      installed = true;
      process.on('warning', warning);
      console.warn = logger.warn;
      console.error = logger.error;
    },
    restore() {
      if (!installed) return;
      installed = false;
      process.off('warning', warning);
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

export function cleanSoakLogs(snapshot) {
  return (
    snapshot?.enabled === true &&
    ['warn', 'error', 'fatal', 'processWarning'].every(
      (key) => snapshot[key] === 0,
    )
  );
}

// This reads only the parent's owned disposable PostgreSQL log, before shutdown.
export async function auditSoakDatabaseLog(path, start = 0) {
  if (!Number.isSafeInteger(start) || start < 0)
    throw new Error('Invalid owned log offset.');
  if (start > (await stat(path)).size)
    throw new Error('Log offset exceeds owned file.');
  const counts = { WARNING: 0, ERROR: 0, FATAL: 0, PANIC: 0 };
  let bytes = 0,
    truncated = false;
  const input = createReadStream(path, { highWaterMark: 16384, start });
  const categories = { duplicateKey: 0, noTransaction: 0, other: 0 };
  input.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) {
      truncated = true;
      input.destroy();
    }
  });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const level = line.match(/\b(WARNING|ERROR|FATAL|PANIC):/u)?.[1];
      if (level) {
        counts[level]++;
        if (line.includes('duplicate key value violates unique constraint'))
          categories.duplicateKey++;
        else if (line.includes('there is no transaction in progress'))
          categories.noTransaction++;
        else categories.other++;
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return {
    counts,
    categories,
    start,
    bytes,
    truncated,
    pass: !truncated && Object.values(counts).every((n) => n === 0),
  };
}
