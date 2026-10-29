import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectLoadTarget } from '../../../scripts/load-target.mjs';
import { summarize } from '../../../scripts/order-search-load.mjs';
import { loopbackTransport } from './load-loopback-transport.mjs';

export const loginFloodProfile = Object.freeze({
  version: 2,
  durationMs: 30000,
  clients: 24,
  firstFailureSpacingMs: 1000,
  repeatAfterMs: 5000,
  perClientEveryMs: 1000,
  loginP95Ms: 1000,
  probeP95Ms: 500,
});

export const loginFloodSource = (client) => `127.0.0.${client + 10}`;
export function loginFloodSchedule(client) {
  const first = client * loginFloodProfile.firstFailureSpacingMs;
  const offsets = [first];
  for (
    let at = Math.max(
      loginFloodProfile.repeatAfterMs,
      first + loginFloodProfile.perClientEveryMs,
    );
    at < loginFloodProfile.durationMs;
    at += loginFloodProfile.perClientEveryMs
  )
    offsets.push(at);
  return offsets;
}
export const loginFloodAttemptCount = () =>
  Array.from(
    { length: loginFloodProfile.clients },
    (_, i) => loginFloodSchedule(i).length,
  ).reduce((a, b) => a + b, 0);

export async function runLoginFlood(env, hooks) {
  const { base, fetch } = await connectLoadTarget(env, loopbackTransport);
  const fixture = JSON.parse(await readFile(env.LOAD_ACCOUNTS_FILE, 'utf8'));
  assert.equal(fixture.actors.length, 3);
  const actors = fixture.actors.map((actor, i) => ({
    ...actor,
    localAddress: `127.0.0.${i + 3}`,
  }));
  const report = {
    version: 2,
    profile: loginFloodProfile,
    environment: 'disposable-development',
    startedAt: new Date().toISOString(),
    baseline: [],
    legitimate: [],
    recovery: [],
    attack: [],
    probes: [],
    sharedSource: [],
    victimDuring: [],
    victimFreshSource: [],
    missedAttack: 0,
    missedProbes: 0,
    sessionsCreated: 0,
    sessionsRevoked: 0,
  };
  const sessions = [];
  let attackStart;
  const headers = {
    'Content-Type': 'application/json',
    'X-PaServe-Client': 'web',
  };
  const request = (path, localAddress, options = {}) =>
    fetch(new URL(path, base), {
      ...options,
      localAddress,
      signal: AbortSignal.timeout(3000),
    });
  async function signIn(actor, target) {
    const start = performance.now();
    let status = 'network_error',
      ok = false;
    try {
      const response = await request('auth/login', actor.localAddress, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: actor.email,
          password: actor.password,
          keepSignedIn: false,
        }),
      });
      status = String(response.status);
      const data = await response.json();
      const cookie = response.headers.get('set-cookie')?.split(';')[0];
      if (response.ok && cookie) {
        sessions.push({ cookie, localAddress: actor.localAddress });
        report.sessionsCreated++;
      }
      ok =
        response.ok &&
        !!cookie &&
        typeof data.accessToken === 'string' &&
        data.user?.id === actor.id;
      if (ok) actor.token = data.accessToken;
    } catch {
      /* Record failures without credentials or response bodies. */
    }
    target.push({
      status,
      ok,
      ms: performance.now() - start,
      attackOffsetMs: attackStart === undefined ? null : start - attackStart,
    });
  }
  async function probe(actor) {
    for (const kind of ['session', 'menu', 'health']) {
      const start = performance.now();
      let ok = false,
        status = 'network_error';
      try {
        const path =
          kind === 'session'
            ? 'auth/me'
            : kind === 'menu'
              ? `menu/${actor.slug}`
              : 'health/live';
        const response = await request(path, actor.localAddress, {
          headers:
            kind === 'session'
              ? { Authorization: `Bearer ${actor.token}` }
              : {},
        });
        status = String(response.status);
        const data = await response.json();
        ok =
          response.ok &&
          (kind === 'menu'
            ? data.shop?.slug === actor.slug &&
              Array.isArray(data.products) &&
              data.products.length <= 100
            : kind === 'session'
              ? data.user?.id === actor.id &&
                data.user.memberships.some(
                  (m) => m.shopId === actor.shopId && m.role === actor.role,
                )
              : data.api === 'ok');
      } catch {
        /* Aggregate only. */
      }
      report.probes.push({ kind, status, ok, ms: performance.now() - start });
    }
  }
  try {
    await hooks.onStage({ phase: 'login-flood-baseline' });
    const baselineStart = performance.now();
    for (const actor of actors) await signIn(actor, report.baseline);
    report.baselineElapsedMs = performance.now() - baselineStart;
    assert.ok(
      report.baseline.every((s) => s.ok),
      'Baseline sign-ins failed.',
    );
    await hooks.onStage({ phase: 'login-flood-attack' });
    const start = performance.now(),
      end = start + loginFloodProfile.durationMs;
    attackStart = start;
    async function bot(client) {
      for (const [sequence, offset] of loginFloodSchedule(client).entries()) {
        const next = start + offset;
        await sleep(Math.max(0, next - performance.now()));
        if (
          performance.now() >= end ||
          performance.now() - next >= loginFloodProfile.perClientEveryMs
        ) {
          report.missedAttack++;
          continue;
        }
        const began = performance.now();
        let status = 'network_error',
          code,
          retryAfter,
          noStore = false,
          noSession = true;
        try {
          const response = await request(
            'auth/login',
            loginFloodSource(client),
            {
              method: 'POST',
              headers: {
                ...headers,
                'X-Forwarded-For': `192.0.2.${((client * 30 + sequence) % 250) + 1}`,
              },
              body: JSON.stringify({
                email:
                  sequence % 2
                    ? actors[0].email
                    : ` ${actors[0].email.toUpperCase()} `,
                password: 'Incorrect synthetic password',
              }),
            },
          );
          status = String(response.status);
          const data = await response.json();
          const allowedCodes = [
            'INVALID_CREDENTIALS',
            'BOT_CHALLENGE_REQUIRED',
            'RATE_LIMIT_EXCEEDED',
          ];
          code = allowedCodes.includes(data.code) ? data.code : 'other';
          noSession = !response.headers.has('set-cookie') && !data.accessToken;
          retryAfter = Number(response.headers.get('retry-after'));
          noStore =
            response.headers.get('cache-control')?.includes('no-store') ===
            true;
        } catch {
          /* Count bounded transport errors. */
        }
        report.attack.push({
          client,
          priming: sequence === 0,
          attackOffsetMs: began - start,
          status,
          code,
          retryAfter,
          noStore,
          noSession,
          ms: performance.now() - began,
        });
      }
    }
    async function healthyProbes() {
      let next = start + 500;
      while (next < end) {
        await sleep(Math.max(0, next - performance.now()));
        if (performance.now() >= end) {
          report.missedProbes += Math.ceil((end - next) / 1500);
          break;
        }
        await Promise.all(actors.map(probe));
        next += 1500;
        const skipped = Math.min(
          Math.max(0, Math.ceil((performance.now() - next) / 1500)),
          Math.max(0, Math.ceil((end - next) / 1500)),
        );
        report.missedProbes += skipped;
        next += skipped * 1500;
      }
    }
    await Promise.all([
      ...Array.from({ length: loginFloodProfile.clients }, (_, i) => bot(i)),
      healthyProbes(),
      ...actors.map((actor, i) =>
        (async () => {
          await sleep(2000 + i * 9000);
          await signIn(actor, report.legitimate);
        })(),
      ),
      ...[8000, 21000, 27000].map((at) =>
        (async () => {
          await sleep(at);
          await signIn(actors[0], report.victimDuring);
        })(),
      ),
      (async () => {
        await sleep(25000);
        await signIn(
          { ...actors[0], localAddress: '127.0.0.6' },
          report.victimFreshSource,
        );
      })(),
      (async () => {
        await sleep(25000);
        await signIn(
          { ...actors[0], localAddress: loginFloodSource(0) },
          report.sharedSource,
        );
      })(),
    ]);
    await sleep(Math.max(0, end - performance.now()));
    report.attackElapsedMs = performance.now() - start;
    await hooks.onStage({ phase: 'login-flood-recovery' });
    const recoveryStart = performance.now();
    for (const actor of actors) await signIn(actor, report.recovery);
    report.recoveryElapsedMs = performance.now() - recoveryStart;
  } finally {
    for (const session of sessions) {
      try {
        const response = await request('auth/logout', session.localAddress, {
          method: 'POST',
          headers: { ...headers, Cookie: session.cookie },
          body: '{}',
        });
        await response.arrayBuffer();
        if (response.ok) report.sessionsRevoked++;
      } catch {
        /* Cleanup failure prevents acceptance. */
      }
    }
    report.finishedAt = new Date().toISOString();
    report.metrics = Object.fromEntries(
      [
        'baseline',
        'legitimate',
        'recovery',
        'victimDuring',
        'victimFreshSource',
        'attack',
        'probes',
      ].map((kind) => [
        kind,
        summarize(
          report[kind],
          Math.max(
            0.001,
            (kind === 'baseline'
              ? report.baselineElapsedMs
              : kind === 'recovery'
                ? report.recoveryElapsedMs
                : report.attackElapsedMs) / 1000,
          ),
        ),
      ]),
    );
    await writeFile(env.LOAD_REPORT, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}
