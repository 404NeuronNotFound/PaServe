import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { workloadProfile } from './recovery-workload.client.mjs';
import { assessRecoveryWorkload } from '../../../scripts/recovery-workload-results.mjs';

export async function recoveryWorkload({ origin, prisma, admin }) {
  const samples = [];
  let sampleFailures = 0,
    skipped = 0;
  /** @type {Promise<void> | undefined} */
  let pending;
  const loop = monitorEventLoopDelay({ resolution: 10 });
  let lastCpu = process.cpuUsage(),
    lastTime = performance.now();
  const startCpu = lastCpu,
    started = lastTime;
  const before = prisma.databasePoolSnapshot();
  const collect = async () => {
    if (pending) {
      skipped++;
      return pending;
    }
    pending = (async () => {
      try {
        const database = (
          await admin.query(`SELECT
          count(*) FILTER (WHERE backend_type='client backend')::int AS clients,
          count(*) FILTER (WHERE pid<>pg_backend_pid() AND state='active')::int AS active,
          count(*) FILTER (WHERE pid<>pg_backend_pid() AND wait_event_type='Lock')::int AS "lockWaiters",
          count(*) FILTER (WHERE pid<>pg_backend_pid() AND state='active' AND query_start<clock_timestamp()-interval '100 milliseconds')::int AS "slowActive"
          FROM pg_stat_activity WHERE datname=current_database()`)
        ).rows[0];
        const now = performance.now(),
          cpu = process.cpuUsage(),
          memory = process.memoryUsage(),
          pool = prisma.databasePoolSnapshot();
        if (samples.length >= 600) throw new Error('Resource sample limit');
        samples.push({
          elapsedMs: now - started,
          apiCpuCoreEquivalent:
            (cpu.user + cpu.system - lastCpu.user - lastCpu.system) /
            Math.max(1, (now - lastTime) * 1000),
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          poolTotal: pool.total,
          poolIdle: pool.idle,
          poolWaiting: pool.waiting,
          databaseClientsIncludingMonitor: database.clients,
          databaseActiveExcludingMonitor: database.active,
          lockWaiters: database.lockWaiters,
          slowActiveQueries: database.slowActive,
        });
        lastTime = now;
        lastCpu = cpu;
      } catch {
        sampleFailures++;
      }
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  const child = fork(
    fileURLToPath(new URL('./recovery-workload.client.mjs', import.meta.url)),
    [],
    {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: {
        TIMEOUT_DB_LOCAL_FIXTURE: 'true',
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) =>
            ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'].includes(
              key.toUpperCase(),
            ),
          ),
        ),
      },
    },
  );
  let timer, calibrationTimer;
  /** @type {Promise<boolean> | undefined} */
  let calibration;
  try {
    loop.enable();
    await collect();
    timer = setInterval(() => void collect(), workloadProfile.sampleIntervalMs);
    calibrationTimer = setTimeout(() => {
      calibration = prisma.$queryRawUnsafe('SELECT 1 FROM pg_sleep(0.28)').then(
        () => true,
        () => false,
      );
    }, 5000);
    const client = await new Promise((resolve, reject) => {
      let result;
      const deadline = setTimeout(() => {
        child.kill();
        reject(new Error('Workload child deadline'));
      }, 50000);
      child.once('message', (message) => {
        result = message.result;
      });
      child.once('error', () => {
        clearTimeout(deadline);
        reject(new Error('Workload child error'));
      });
      child.once('exit', (code) => {
        clearTimeout(deadline);
        if (code === 0 && result) resolve(result);
        else reject(new Error('Workload child failed'));
      });
      child.send({ origin });
    });
    assert.equal(
      await calibration,
      true,
      'Slow-query calibration did not complete',
    );
    await collect();
    const pool = prisma.databasePoolSnapshot(),
      cpu = process.cpuUsage(startCpu),
      elapsedMs = performance.now() - started;
    const peak = (key) => Math.max(...samples.map((sample) => sample[key]));
    const queryBefore = before.queryWorkloads.other,
      queryAfter = pool.queryWorkloads.other;
    const report = {
      profile: workloadProfile,
      ...client,
      resourceScope:
        'API, TCP proxy and collector process; load clients run in a separate child. PostgreSQL CPU is not API CPU.',
      resources: {
        elapsedMs,
        apiCpuCoreEquivalent: (cpu.user + cpu.system) / (elapsedMs * 1000),
        peakApiCpuCoreEquivalent: peak('apiCpuCoreEquivalent'),
        rssStartBytes: samples[0].rssBytes,
        rssPeakBytes: peak('rssBytes'),
        rssEndBytes: samples.at(-1).rssBytes,
        heapPeakBytes: peak('heapUsedBytes'),
        eventLoopP95Ms: loop.percentile(95) / 1e6,
        apiPoolPeak: peak('poolTotal'),
        apiPoolWaitingPeak: peak('poolWaiting'),
        apiPoolTotalAtEnd: pool.total,
        apiPoolIdleAtEnd: pool.idle,
        apiPoolWaitingAtEnd: pool.waiting,
        databaseClientPeakIncludingMonitor: peak(
          'databaseClientsIncludingMonitor',
        ),
        databaseActivePeakExcludingMonitor: peak(
          'databaseActiveExcludingMonitor',
        ),
        lockWaiterPeak: peak('lockWaiters'),
        slowActivePeak: peak('slowActiveQueries'),
        slowObservationSamples: samples.filter(
          (sample) => sample.slowActiveQueries > 0,
        ).length,
        completedSlowQueriesAt250Ms: queryAfter.slow - queryBefore.slow,
        queryCount: queryAfter.count - queryBefore.count,
        queryFailures: queryAfter.failures - queryBefore.failures,
      },
      monitoring: {
        intervalMs: workloadProfile.sampleIntervalMs,
        sampleFailures,
        skipped,
        samples,
      },
    };
    assert.ok(
      sampleFailures === 0 &&
        samples.length >= 320 &&
        report.resources.slowActivePeak >= 1 &&
        report.resources.completedSlowQueriesAt250Ms >= 1,
      'Resource/slow-query monitoring incomplete',
    );
    report.pass = assessRecoveryWorkload(report).pass;
    return report;
  } finally {
    clearInterval(timer);
    clearTimeout(calibrationTimer);
    if (pending) await pending;
    if (calibration) await calibration;
    loop.disable();
    if (child.exitCode === null) child.kill();
  }
}
