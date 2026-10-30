import assert from 'node:assert/strict';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const DATABASE_SAMPLE = `WITH activity AS MATERIALIZED (
  SELECT backend_type,pid,state,wait_event_type FROM pg_stat_activity WHERE datname=current_database()
) SELECT numbackends::int connections,
  (SELECT count(*)::int FROM activity WHERE backend_type='client backend') "clientConnections",
  (SELECT count(*)::int FROM activity WHERE backend_type<>'client backend') "backgroundConnections",
  (SELECT count(*)::int FROM activity) "activityBackends",xact_commit,xact_rollback,
  blks_read,blks_hit,tup_returned,tup_fetched,tup_inserted,tup_updated,tup_deleted,deadlocks,temp_bytes,
  pg_database_size(current_database()) bytes,
  (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active') active,
  (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='idle in transaction') idle_in_transaction,
  (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock') lock_waiters
  FROM pg_stat_database WHERE datname=current_database()`;
const round = (n) => Number(n.toFixed(3));
const buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 5000, 10000, Infinity];

export function assertLoadMonitoring(report, { search = false } = {}) {
  assert.ok(
    report && report.samples.length >= 2,
    'Missing continuous monitoring.',
  );
  assert.equal(report.sampleFailures, 0, 'A monitoring sample failed.');
  assert.equal(report.truncated, false, 'Monitoring samples were truncated.');
  const live = report.samples.filter((sample) => sample.api);
  assert.ok(
    live.length >= 2 &&
      live.every((sample) => sample.database && sample.network),
    'Missing API/DB/network monitoring.',
  );
  for (const sample of live) {
    for (const value of [
      sample.process?.cpuCoreEquivalent,
      sample.process?.rssBytes,
      sample.process?.eventLoopP95Ms,
      sample.database.connections,
      sample.database.active,
      sample.database.lock_waiters,
      sample.database.xact_commit,
      sample.database.bytes,
      sample.api.pool?.total,
      sample.api.pool?.waiting,
      sample.api.capacity?.active?.total,
      sample.api.capacity?.admitted,
      sample.api.fairness?.activeScopeLeases,
      sample.network.receivedBytes,
      sample.network.sentBytes,
    ])
      assert.ok(
        Number.isFinite(value) && value >= 0,
        'Missing or invalid API/DB/network metric.',
      );
  }
  assert.ok(
    report.http.requests > 0 &&
      report.network.receivedBytes > 0 &&
      report.network.sentBytes > 0,
    'Missing HTTP network traffic measurements.',
  );
  if (search)
    assert.ok(
      live.filter((sample) => sample.phase === 'optional-search').length >= 3,
      'Search workload was not continuously monitored.',
    );
}

/** Aggregate-only metrics: never SQL text, IDs, URLs, headers or payload bodies. */
export class LoadMonitor {
  constructor({
    client,
    phase,
    apiSnapshot = () => null,
    intervalMs = 500,
    maxSamples = 480,
  }) {
    this.client = client;
    this.phase = phase;
    this.apiSnapshot = apiSnapshot;
    this.intervalMs = intervalMs;
    this.maxSamples = maxSamples;
    this.samples = [];
    this.sampleFailures = 0;
    this.skippedSamples = 0;
    this.truncated = false;
    this.network = {
      receivedBytes: 0,
      sentBytes: 0,
      connections: 0,
      peakConnections: 0,
    };
    this.http = {
      requests: 0,
      completed: 0,
      aborted: 0,
      inFlight: 0,
      peakInFlight: 0,
      statusCounts: {},
      latencyCount: 0,
      latencyTotalMs: 0,
      latencyMaxMs: 0,
      latencyBuckets: buckets.map(() => 0),
    };
    this.sockets = new Map();
    this.loop = monitorEventLoopDelay({ resolution: 20 });
    this.onConnection = (socket) => {
      this.sockets.set(socket, { received: 0, sent: 0 });
      this.network.connections++;
      this.network.peakConnections = Math.max(
        this.network.peakConnections,
        this.sockets.size,
      );
      socket.once('close', () => {
        this.flushSocket(socket);
        this.sockets.delete(socket);
      });
    };
    this.onRequest = (_request, response) => {
      this.http.requests++;
      this.http.inFlight++;
      this.http.peakInFlight = Math.max(
        this.http.peakInFlight,
        this.http.inFlight,
      );
      const start = performance.now();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.http.inFlight--;
        if (!response.writableFinished) {
          this.http.aborted++;
          return;
        }
        const ms = performance.now() - start;
        this.http.completed++;
        this.http.latencyCount++;
        this.http.latencyTotalMs += ms;
        this.http.latencyMaxMs = Math.max(this.http.latencyMaxMs, ms);
        this.http.latencyBuckets[buckets.findIndex((bound) => ms <= bound)]++;
        const status =
          response.statusCode >= 100 && response.statusCode <= 599
            ? String(response.statusCode)
            : 'other';
        this.http.statusCounts[status] =
          (this.http.statusCounts[status] ?? 0) + 1;
      };
      response.once('finish', finish);
      response.once('close', finish);
    };
  }
  attachHttp(server) {
    this.server = server;
    server.on('connection', this.onConnection);
    server.on('request', this.onRequest);
  }
  flushSocket(socket) {
    const previous = this.sockets.get(socket);
    if (!previous) return;
    this.network.receivedBytes += Math.max(
      0,
      socket.bytesRead - previous.received,
    );
    this.network.sentBytes += Math.max(0, socket.bytesWritten - previous.sent);
    previous.received = socket.bytesRead;
    previous.sent = socket.bytesWritten;
  }
  networkSnapshot() {
    for (const socket of this.sockets.keys()) this.flushSocket(socket);
    return { ...this.network, activeConnections: this.sockets.size };
  }
  async start() {
    await this.client.connect();
    this.startTime = performance.now();
    this.cpu = process.cpuUsage();
    this.lastTime = this.startTime;
    this.loop.enable();
    await this.sampleNow();
    this.timer = setInterval(() => {
      if (this.pending) this.skippedSamples++;
      else void this.sampleNow();
    }, this.intervalMs);
    this.timer.unref();
  }
  async sampleNow() {
    if (this.pending) {
      await this.pending;
      return;
    }
    this.pending = this.collect().finally(() => {
      this.pending = undefined;
    });
    await this.pending;
  }
  async collect() {
    try {
      const started = performance.now();
      const database = (await this.client.query(DATABASE_SAMPLE)).rows[0];
      assert.ok(database, 'No database monitoring row.');
      const databaseMetrics = Object.fromEntries(
        Object.entries(database).map(([key, value]) => {
          const number = Number(value);
          assert.ok(Number.isFinite(number));
          return [key, number];
        }),
      );
      const now = performance.now(),
        cpu = process.cpuUsage();
      const deltaCpu = cpu.user + cpu.system - this.cpu.user - this.cpu.system;
      const memory = process.memoryUsage();
      const sample = {
        elapsedMs: round(now - this.startTime),
        phase: this.phase(),
        process: {
          cpuCoreEquivalent: round(
            deltaCpu / Math.max(1, (now - this.lastTime) * 1000),
          ),
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
          arrayBufferBytes: memory.arrayBuffers,
          externalBytes: memory.external,
          eventLoopP95Ms: round(this.loop.percentile(95) / 1e6),
          eventLoopMaxMs: round(this.loop.max / 1e6),
        },
        api: this.apiSnapshot(),
        database: databaseMetrics,
        monitorQueryMs: round(now - started),
        network: this.networkSnapshot(),
      };
      this.loop.reset();
      this.lastTime = now;
      this.cpu = cpu;
      if (this.samples.length < this.maxSamples) this.samples.push(sample);
      else this.truncated = true;
    } catch {
      this.sampleFailures++;
    }
  }
  async stop() {
    if (this.result) return this.result;
    clearInterval(this.timer);
    await this.sampleNow();
    this.loop.disable();
    this.server?.off('connection', this.onConnection);
    this.server?.off('request', this.onRequest);
    const first = this.samples[0]?.database,
      last = this.samples.at(-1)?.database;
    const counterKeys = [
      'xact_commit',
      'xact_rollback',
      'blks_read',
      'blks_hit',
      'tup_returned',
      'tup_fetched',
      'tup_inserted',
      'tup_updated',
      'tup_deleted',
      'deadlocks',
      'temp_bytes',
    ];
    this.result = {
      intervalMs: this.intervalMs,
      maxSamples: this.maxSamples,
      sampleFailures: this.sampleFailures,
      skippedSamples: this.skippedSamples,
      truncated: this.truncated,
      processScope:
        'API and collector process; fixture generation shares this process during setup. Search clients run in a separate process.',
      networkScope:
        'Observed loopback HTTP socket bytes, including headers; not NIC/WAN or database protocol bandwidth.',
      http: {
        ...this.http,
        latencyMeanMs: this.http.latencyCount
          ? round(this.http.latencyTotalMs / this.http.latencyCount)
          : null,
        latencyBoundsMs: buckets.map((n) =>
          Number.isFinite(n) ? n : 'overflow',
        ),
      },
      network: this.networkSnapshot(),
      databaseDeltas:
        first && last
          ? Object.fromEntries(
              counterKeys.map((key) => [key, last[key] - first[key]]),
            )
          : null,
      samples: this.samples,
    };
    await this.client.end();
    return this.result;
  }
}
