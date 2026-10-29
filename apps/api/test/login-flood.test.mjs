import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { evaluateLoginFlood } from './login-flood.metrics.mjs';
import {
  loginFloodProfile,
  loginFloodSchedule,
  loginFloodAttemptCount,
} from './login-flood.workload.mjs';
import { loopbackTransport } from './load-loopback-transport.mjs';
import { loadFixtureEnvironment } from './load-fixture-environment.mjs';

function fixture() {
  const successes = () => Array.from({ length: 3 }, () => ({ ok: true }));
  const workload = {
    profile: loginFloodProfile,
    attackElapsedMs: 30000,
    missedAttack: 0,
    missedProbes: 0,
    baseline: successes(),
    legitimate: successes(),
    recovery: successes(),
    victimDuring: [8000, 21000, 27000].map((attackOffsetMs) => ({
      ok: true,
      attackOffsetMs,
    })),
    victimFreshSource: [{ ok: true, attackOffsetMs: 25000 }],
    probes: ['menu', 'session', 'health'].flatMap((kind) =>
      Array.from({ length: 60 }, () => ({ kind, ok: true, ms: 5 })),
    ),
    attack: Array.from({ length: loginFloodProfile.clients }, (_, client) =>
      loginFloodSchedule(client).map((offset, sequence) => ({
        client,
        priming: sequence === 0,
        attackOffsetMs: offset,
        status: sequence === 0 ? '401' : sequence % 2 ? '403' : '429',
        code:
          sequence === 0
            ? 'INVALID_CREDENTIALS'
            : sequence % 2
              ? 'BOT_CHALLENGE_REQUIRED'
              : 'RATE_LIMIT_EXCEEDED',
        ms: 5,
        noSession: true,
        noStore: true,
        retryAfter: 10,
      })),
    ).flat(),
    sharedSource: [{ status: '429' }],
    sessionsCreated: 13,
    sessionsRevoked: 13,
    metrics: {
      baseline: { p95Ms: 100 },
      legitimate: { p95Ms: 100 },
      recovery: { p95Ms: 100 },
      victimDuring: { p95Ms: 100 },
      victimFreshSource: { p95Ms: 100 },
      probes: { p95Ms: 20 },
    },
  };
  const monitoring = {
    sampleFailures: 0,
    truncated: false,
    samples: Array.from({ length: 300 }, (_, i) => ({
      phase: 'login-flood-attack',
      elapsedMs: i * 100,
      process: { cpuCoreEquivalent: 0.5 },
      api: {
        passwords: {
          active: 1,
          maxConcurrent: 2,
          reservedKiB: 65536,
          memoryBudgetKiB: 131072,
        },
      },
    })),
  };
  const evidence = {
    peers: { attacker: loginFloodAttemptCount() + 1, legitimate: 7, other: 0 },
    distinctAttackSources: 24,
    hashVerifyJobs: 37,
    targetAccountReads: 31,
    victimUnchanged: true,
    victimSessionRows: 7,
    attackerSessions: 0,
    attackerUnchanged: true,
    usersUnchanged: true,
    sessionRows: 13,
    revokedRows: 13,
    externalCallsDuringWorkload: 0,
  };
  return { workload, monitoring, evidence };
}

await test('accepts observed throttling with successful independent legitimate clients and bounded real work', () => {
  const f = fixture();
  assert.equal(
    evaluateLoginFlood(f.workload, f.monitoring, f.evidence).pass,
    true,
  );
});

for (const [name, mutate] of [
  [
    'missed bot schedules',
    (f) => {
      f.workload.missedAttack = 1;
    },
  ],
  [
    'legitimate rejection',
    (f) => {
      f.workload.legitimate[0].ok = false;
    },
  ],
  [
    'slow legitimate login',
    (f) => {
      f.workload.metrics.legitimate.p95Ms = 1001;
    },
  ],
  [
    'unbounded hash memory',
    (f) => {
      f.monitoring.samples[0].api.passwords.reservedKiB = 999999;
    },
  ],
  [
    'excessive attacker database reads',
    (f) => {
      f.evidence.targetAccountReads = 300;
    },
  ],
  [
    'attacker session',
    (f) => {
      f.evidence.attackerSessions = 1;
    },
  ],
  [
    'attacked account write',
    (f) => {
      f.evidence.attackerUnchanged = false;
    },
  ],
  [
    'no socket proof',
    (f) => {
      f.evidence.peers.attacker = 0;
    },
  ],
  [
    'missing retry policy',
    (f) => {
      f.workload.attack[20].retryAfter = null;
    },
  ],
  [
    'challenge not proven',
    (f) => {
      f.workload.attack[5].code = 'other';
    },
  ],
  [
    'unfinished session cleanup',
    (f) => {
      f.workload.sessionsRevoked = 8;
    },
  ],
  [
    'lost monitoring',
    (f) => {
      f.monitoring.samples.splice(100, 50);
    },
  ],
  [
    'victim account blocked',
    (f) => {
      f.workload.victimDuring[1].ok = false;
    },
  ],
  [
    'new victim device challenged',
    (f) => {
      f.workload.victimFreshSource[0].ok = false;
    },
  ],
  [
    'victim account changed',
    (f) => {
      f.evidence.victimUnchanged = false;
    },
  ],
  [
    'source diversity not established',
    (f) => {
      f.evidence.distinctAttackSources = 1;
    },
  ],
  [
    'old account threshold not exercised',
    (f) => {
      f.workload.attack.find((s) => s.priming).status = '403';
    },
  ],
])
  await test(`flood acceptance fails for ${String(name)}`, () => {
    const f = fixture();
    mutate(f);
    assert.equal(
      evaluateLoginFlood(f.workload, f.monitoring, f.evidence).pass,
      false,
    );
  });

await test('loopback transport uses real source sockets, refuses redirects and prevents remote requests', async () => {
  let peer;
  const server = http.createServer((req, res) => {
    peer = req.socket.remoteAddress;
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'https://example.invalid' });
      res.end();
    } else res.end('owned fixture');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(
      await (
        await loopbackTransport(base, { localAddress: '127.0.0.3' })
      ).text(),
      'owned fixture',
    );
    assert.equal(peer, '127.0.0.3');
    await assert.rejects(loopbackTransport(`${base}/redirect`));
    assert.throws(() => loopbackTransport('https://example.invalid'));
    assert.throws(() => loopbackTransport(base, { localAddress: '192.0.2.1' }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await test('only the managed runner enables flood/challenge fixtures', () => {
  const options = {
    databaseUrl: `postgresql://timeout_fixture:${'a'.repeat(48)}@127.0.0.1:45678/postgres`,
    directory: 'fixture-directory',
    report: 'fixture-report',
  };
  assert.equal(
    loadFixtureEnvironment(
      { LOAD_LOGIN_FLOOD: '1', AUTH_BOT_CHALLENGE_ENABLED: 'true' },
      options,
    ).LOAD_LOGIN_FLOOD,
    '0',
  );
  const env = loadFixtureEnvironment({}, { ...options, loginFlood: true });
  assert.equal(env.LOAD_LOGIN_FLOOD, '1');
  assert.equal(env.AUTH_BOT_CHALLENGE_ENABLED, 'true');
  assert.ok(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_HOSTNAMES);
});
