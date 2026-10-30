import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { NewOrderEventsService } from '../dist/modules/orders/new-order-events.service.js';
import { fanoutIdentities } from './realtime-fanout.identity.mjs';
import { openFanoutDatabase } from './realtime-fanout.database.mjs';
import {
  fanoutProfile,
  hostedFanoutSettings,
  evaluateFanout,
} from './realtime-fanout.settings.mjs';

const args = process.argv.slice(2),
  mode = args[0];
assert.ok(['local', 'hosted'].includes(mode), 'Choose local or hosted.');
const settings =
  mode === 'hosted'
    ? hostedFanoutSettings(
        JSON.parse(await readFile(resolve(args[1]), 'utf8')),
        args[2],
        args[3],
      )
    : null;
const started = performance.now(),
  capability = randomBytes(32).toString('hex');
const report = {
  version: 2,
  profile: fanoutProfile,
  mode:
    mode === 'hosted'
      ? 'disposable-supabase-broadcast'
      : 'controlled-local-relay',
  supabaseVerified: false,
  databaseVerified: false,
  delivery: {
    expected: 0,
    received: 0,
    dropped: 0,
    unexpectedSseClosures: 0,
    expectedSseClosures: 0,
    unexpectedWireClosures: 0,
    expectedWireClosures: 0,
    expectedOfflineDrops: 0,
    unexpectedChannelClosures: 0,
    expectedChannelInterruptions: 0,
    channelRejoins: 0,
  },
  roles: Object.fromEntries(
    ['CUSTOMER', 'OWNER', 'CASHIER', 'KITCHEN'].map((role) => [
      role,
      { subscribers: 0, deliveries: 0 },
    ]),
  ),
  startedAt: new Date().toISOString(),
  stages: [],
  controls: {},
  resources: [],
  publishes: 0,
  cleanup: {},
};
const reportPath = resolve(
  import.meta.dirname,
  `../../../artifacts/performance/realtime-fanout-${mode}.json`,
);
const services = [],
  providers = [],
  recipients = [],
  requests = new Set(),
  sockets = new Set();
let server,
  resourceTimer,
  failure,
  broadcasts = 0;
let providerErrors = 0;
let currentStep = 'initialization';
let identities,
  databaseFixture,
  cleaning = false;
const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();
let lastCpu = process.cpuUsage(),
  lastTime = performance.now();
const sample = () => {
  const now = performance.now(),
    cpu = process.cpuUsage(),
    memory = process.memoryUsage();
  if (report.resources.length < 600)
    report.resources.push({
      elapsedMs: now - started,
      cpuCoreEquivalent:
        (cpu.user - lastCpu.user + (cpu.system - lastCpu.system)) /
        1000 /
        Math.max(1, now - lastTime),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      eventLoopP95Ms: lag.percentile(95) / 1e6,
    });
  lastCpu = cpu;
  lastTime = now;
  lag.reset();
};
const tenants = Array.from({ length: 3 }, () => ({
  shopId: randomUUID(),
  orderId: randomUUID(),
}));
const topics = tenants.flatMap(({ shopId, orderId }, tenant) => {
  return [
    {
      tenant,
      kind: 'cashier',
      topic: `staff:confirmed:${shopId}`,
      scope: { shopId },
      orderId,
    },
    {
      tenant,
      kind: 'kitchen',
      topic: `staff:preparation:${shopId}`,
      scope: { shopId },
      orderId,
    },
    {
      tenant,
      kind: 'customer',
      topic: `customer:confirmed:${shopId}:${orderId}`,
      scope: { shopId, orderId },
      orderId,
    },
  ];
});
const eventNames = ['order_preparing', 'order_ready', 'order_completed'];
const clocks = new Map();
async function until(condition, label, timeout = 10000) {
  currentStep = label;
  const end = performance.now() + timeout;
  while (!condition()) {
    if (providerErrors) throw new Error('Provider subscription error.');
    if (
      performance.now() > end ||
      performance.now() - started > fanoutProfile.deadlineMs
    )
      throw new Error(`Fanout timeout: ${label}`);
    await sleep(5);
  }
}

function localProvider() {
  const channels = new Map();
  const received = new Map();
  const state = { offline: false, faulting: false, connected: new Map() };
  return {
    channels,
    received,
    state,
    pause() {
      state.offline = true;
      state.faulting = true;
      report.delivery.expectedWireClosures++;
      for (const channel of channels.values()) {
        report.delivery.expectedChannelInterruptions++;
        state.connected.set(channel.topic, false);
        channel.status('CHANNEL_ERROR');
      }
    },
    resume() {
      state.offline = false;
      for (const channel of channels.values()) {
        report.delivery.channelRejoins++;
        state.connected.set(channel.topic, true);
        channel.status('SUBSCRIBED');
      }
    },
    channel(topic) {
      const channel = {
        topic,
        on(_type, _filter, receive) {
          channel.receive = receive;
          return channel;
        },
        subscribe(status) {
          channel.status = status;
          channels.set(topic, channel);
          state.connected.set(topic, true);
          status('SUBSCRIBED');
          return channel;
        },
      };
      return channel;
    },
    async removeChannel(channel) {
      channels.delete(channel.topic);
    },
    async removeAllChannels() {
      channels.clear();
    },
    realtime: { disconnect: async () => {} },
    emit(topic, event, payload) {
      if (state.offline) return;
      received.set(topic, (received.get(topic) ?? 0) + 1);
      channels.get(topic)?.receive({ event, payload });
    },
  };
}
function actualProvider() {
  const state = {
    offline: false,
    faulting: false,
    connected: new Map(),
    sockets: new Set(),
    leaving: new Set(),
    joined: new Set(),
  };
  class FaultSocket extends WebSocket {
    constructor(url, protocols) {
      super(
        state.offline ? 'ws://127.0.0.1:1/fixture-offline' : url,
        protocols,
      );
      state.sockets.add(this);
      this.addEventListener('close', () => {
        state.sockets.delete(this);
        if (!cleaning) {
          if (state.faulting) report.delivery.expectedWireClosures++;
          else report.delivery.unexpectedWireClosures++;
        }
      });
    }
  }
  const client = createClient(settings.url, settings.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: FaultSocket },
    }),
    channels = new Map(),
    received = new Map();
  return {
    channels,
    received,
    state,
    pause() {
      state.offline = true;
      state.faulting = true;
      for (const socket of state.sockets)
        if (socket.readyState === WebSocket.OPEN)
          socket.close(4001, 'fixture interruption');
    },
    resume() {
      state.offline = false;
    },
    channel(topic, options) {
      state.leaving.delete(topic);
      const channel = client.channel(topic, options);
      const on = channel.on.bind(channel),
        subscribe = channel.subscribe.bind(channel);
      channel.on = (type, filter, callback) =>
        on(type, filter, (message) => {
          received.set(topic, (received.get(topic) ?? 0) + 1);
          callback(message);
        });
      channel.subscribe = (callback, ...args) =>
        subscribe(
          (status) => {
            if (status === 'SUBSCRIBED') {
              if (state.joined.has(topic)) report.delivery.channelRejoins++;
              state.joined.add(topic);
            } else if (
              ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status) &&
              !cleaning
            ) {
              if (state.faulting)
                report.delivery.expectedChannelInterruptions++;
              else if (status === 'CLOSED' && !state.leaving.has(topic))
                report.delivery.unexpectedChannelClosures++;
            }
            state.connected.set(topic, status === 'SUBSCRIBED');
            if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
              if (!state.faulting) providerErrors++;
            }
            callback(status);
          },
          ...args,
        );
      channels.set(topic, channel);
      return channel;
    },
    async removeChannel(channel) {
      for (const [topic, value] of channels)
        if (value === channel) state.leaving.add(topic);
      await client.removeChannel(channel);
      for (const [topic, value] of channels)
        if (value === channel) channels.delete(topic);
    },
    async removeAllChannels() {
      await client.removeAllChannels();
      channels.clear();
    },
    realtime: client.realtime,
    client,
  };
}
function frame(recipient, raw) {
  const event = /^event: ([a-z_]+)$/m.exec(raw)?.[1],
    encoded = /^data: (.+)$/m.exec(raw)?.[1];
  if (!event || !encoded) throw new Error('Invalid SSE framing.');
  const data = JSON.parse(encoded),
    target = topics[recipient.topicIndex];
  const expected = eventNames.includes(event)
    ? { ...target.scope, orderId: target.orderId }
    : target.scope;
  if (JSON.stringify(data) !== JSON.stringify(expected)) {
    recipient.invalidFrames++;
    return;
  }
  recipient.counts[event] = (recipient.counts[event] ?? 0) + 1;
  if (eventNames.includes(event)) {
    const at = clocks.get(`${recipient.topicIndex}:${event}`);
    if (at === undefined) recipient.invalidFrames++;
    else recipient.latencies.push(performance.now() - at);
    report.roles[recipient.role].deliveries++;
  }
}
function connect(recipient, port) {
  const req = http.get(
    {
      hostname: '127.0.0.1',
      port,
      path: `/sse/${recipient.index}`,
      agent: false,
      headers: { 'X-Fixture-Capability': capability },
    },
    (response) => {
      if (
        response.statusCode !== 200 ||
        !response.headers['content-type']?.startsWith('text/event-stream')
      ) {
        recipient.invalidFrames++;
        response.resume();
        return;
      }
      recipient.response = response;
      let buffer = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffer += chunk;
        if (buffer.length > 16384) {
          recipient.invalidFrames++;
          req.destroy();
          return;
        }
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          try {
            frame(recipient, raw);
          } catch {
            recipient.invalidFrames++;
          }
        }
      });
      response.on('close', () => {
        closed(recipient);
      });
      response.on('error', () => {
        closed(recipient);
      });
    },
  );
  requests.add(req);
  recipient.request = req;
  req.on('close', () => requests.delete(req));
  req.on('error', () => {
    closed(recipient);
  });
}
function closed(recipient) {
  if (recipient.closed) return;
  recipient.closed = true;
  if (cleaning || recipient.expectedClose)
    report.delivery.expectedSseClosures++;
  else report.delivery.unexpectedSseClosures++;
}
function addRecipient(apiIndex, topicIndex, role, countRole = true) {
  const recipient = {
    index: recipients.length,
    apiIndex,
    topicIndex,
    allowed: true,
    counts: {},
    latencies: [],
    invalidFrames: 0,
    closed: false,
    role,
    actor: identities.actors.find(
      (actor) =>
        actor.tenant === topics[topicIndex].tenant && actor.role === role,
    ),
  };
  recipients.push(recipient);
  if (countRole) report.roles[role].subscribers++;
  return recipient;
}
const channelCount = () => providers.reduce((n, p) => n + p.channels.size, 0);
function percentile(values, p) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.length
    ? Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 1000) / 1000
    : null;
}
let publisher;
const publisherChannels = new Map();
async function publish(topicIndex, event, overrides = {}) {
  if (providerErrors) throw new Error('Provider subscription error.');
  if (++broadcasts > fanoutProfile.maxPublishes)
    throw new Error('Fixture publication budget exceeded.');
  const target = topics[topicIndex],
    payload = {
      ...target.scope,
      orderId: target.orderId,
      privateActor: 'must-not-relay',
      ...overrides,
    };
  clocks.set(`${topicIndex}:${event}`, performance.now());
  if (mode === 'local')
    for (const provider of providers)
      provider.emit(target.topic, event, payload);
  else
    assert.equal(
      await publisherChannels
        .get(topicIndex)
        .send({ type: 'broadcast', event, payload }),
      'ok',
      'Supabase publication failed.',
    );
}
async function delivered(topicIndex, event) {
  const affected = recipients.filter(
      (r) => !r.closed && r.allowed && r.topicIndex === topicIndex,
    ),
    counts = affected.map((r) => r.counts[event] ?? 0);
  await publish(topicIndex, event);
  await reconcile(affected, counts, event);
}
async function reconcile(affected, counts, event) {
  report.delivery.expected += affected.length;
  try {
    await until(
      () => affected.every((r, i) => (r.counts[event] ?? 0) >= counts[i] + 1),
      'status delivery',
    );
  } finally {
    report.delivery.received += affected.reduce(
      (n, r, i) =>
        n + Math.min(1, Math.max(0, (r.counts[event] ?? 0) - counts[i])),
      0,
    );
    report.delivery.dropped += affected.filter(
      (r, i) => (r.counts[event] ?? 0) < counts[i] + 1,
    ).length;
  }
  assert.ok(
    affected.every((r, i) => (r.counts[event] ?? 0) === counts[i] + 1),
    'Duplicate delivery.',
  );
}
async function recoveredReads() {
  if (databaseFixture)
    assert.ok(
      (await databaseFixture.states()).every((state) => state === 'COMPLETED'),
    );
  for (let topic = 0; topic < topics.length; topic++)
    await delivered(topic, 'order_completed');
}

try {
  resourceTimer = setInterval(sample, 100);
  sample();
  identities = await fanoutIdentities(tenants);
  report.authorizationMatrix = await identities.negativeMatrix(topics);
  assert.ok(
    Object.values(report.authorizationMatrix).every(Boolean),
    'Authorization matrix failed.',
  );
  report.controls.roles = true;
  if (mode === 'hosted') {
    currentStep = 'temporary database setup';
    databaseFixture = await openFanoutDatabase(
      settings.databaseUrl,
      settings.projectRef,
      tenants,
    );
  }
  for (let i = 0; i < fanoutProfile.apiInstances; i++) {
    const provider = mode === 'local' ? localProvider() : actualProvider();
    providers.push(provider);
    const service = new NewOrderEventsService(new ConfigService({}), {}, {});
    // Test-only transport injection; relay/channel validation remains production code.
    service.client = provider;
    services.push(service);
  }
  server = http.createServer((req, res) => {
    const supplied = req.headers['x-fixture-capability'];
    if (
      typeof supplied !== 'string' ||
      supplied.length !== 64 ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(capability))
    ) {
      res.writeHead(404).end();
      return;
    }
    const match = /^\/sse\/(\d{1,2})$/.exec(req.url ?? ''),
      recipient = match ? recipients[Number(match[1])] : undefined;
    if (!recipient || recipient.opened) {
      res.writeHead(404).end();
      return;
    }
    recipient.opened = true;
    const target = topics[recipient.topicIndex];
    void services[recipient.apiIndex]
      .relay(
        target.topic,
        eventNames,
        target.scope,
        async () => {
          await recipient.authGate;
          await identities.authorize(recipient.actor, target);
        },
        res,
      )
      .catch(() => {
        if (!res.headersSent) res.writeHead(503);
        res.end();
      });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  if (mode === 'hosted') {
    publisher = createClient(settings.url, settings.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const [index, target] of topics.entries()) {
      currentStep = 'publisher join';
      const channel = publisher.channel(target.topic, {
        config: { private: true, broadcast: { ack: true } },
      });
      publisherChannels.set(index, channel);
      await new Promise((done, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Fixture publisher join timed out.')),
          10000,
        );
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timer);
            done();
          } else if (
            ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)
          ) {
            report.publisherFailureStatus = status;
            clearTimeout(timer);
            reject(new Error('Fixture publisher join rejected.'));
          }
        });
      });
    }
  }
  const plan = [];
  for (const [copy, roles] of [
    [0, ['CUSTOMER', 'OWNER']],
    [0, ['CASHIER', 'KITCHEN']],
    [1, ['CUSTOMER', 'OWNER']],
    [1, ['CASHIER', 'KITCHEN']],
  ])
    for (let tenant = 0; tenant < 3; tenant++)
      for (const role of roles)
        plan.push({
          api: (tenant + copy) % 3,
          topic:
            tenant * 3 + (role === 'CUSTOMER' ? 2 : role === 'KITCHEN' ? 1 : 0),
          role,
        });
  for (const [levelIndex, total] of fanoutProfile.levels.entries()) {
    const phaseAt = performance.now(),
      previous = recipients.length;
    for (const entry of plan.slice(previous, total))
      addRecipient(entry.api, entry.topic, entry.role);
    for (const recipient of recipients.slice(previous))
      connect(recipient, port);
    await until(
      () => recipients.every((r) => (r.counts.resync ?? 0) > 0),
      'initial resync',
    );
    for (const r of recipients) r.latencies = [];
    const event = eventNames[levelIndex],
      affected = recipients.filter((r) => !r.closed),
      counts = affected.map((r) => r.counts[event] ?? 0);
    for (let topic = 0; topic < topics.length; topic++)
      clocks.set(`${topic}:${event}`, performance.now());
    if (databaseFixture) {
      if (levelIndex === 0) {
        const before = recipients.map((r) => JSON.stringify(r.counts));
        await databaseFixture.transition(event, true);
        await sleep(400);
        assert.ok(
          recipients.every((r, i) => JSON.stringify(r.counts) === before[i]),
          'Rolled back update leaked.',
        );
        report.controls.rollback = true;
        for (let topic = 0; topic < topics.length; topic++)
          clocks.set(`${topic}:${event}`, performance.now());
      }
      broadcasts += 9;
      await databaseFixture.transition(event);
    } else
      for (let topic = 0; topic < topics.length; topic++)
        await publish(topic, event);
    await reconcile(affected, counts, event);
    await sleep(Math.max(0, 600 - (performance.now() - phaseAt)));
    const times = recipients.flatMap((r) => r.latencies);
    report.stages.push({
      clients: total,
      upstreamChannels: channelCount(),
      deliveries: times.length,
      expectedDeliveries: total,
      dropped: Math.max(0, total - times.length),
      p50Ms: percentile(times, 0.5),
      p95Ms: percentile(times, 0.95),
      p99Ms: percentile(times, 0.99),
      invalidFrames: recipients.reduce((n, r) => n + r.invalidFrames, 0),
    });
  }
  const before = recipients.map((r) => JSON.stringify(r.counts));
  const receivedBefore = providers.map((provider) => [
    provider.received.get(topics[0].topic) ?? 0,
    provider.received.get(topics[2].topic) ?? 0,
  ]);
  await publish(0, 'order_completed', { shopId: randomUUID() });
  await publish(2, 'order_completed', { orderId: randomUUID() });
  await until(
    () =>
      providers.every((provider, i) =>
        [0, 2].every(
          (topic, index) =>
            !provider.channels.has(topics[topic].topic) ||
            (provider.received.get(topics[topic].topic) ?? 0) >
              receivedBefore[i][index],
        ),
      ),
    'invalid broadcast arrival',
  );
  await sleep(50);
  report.controls.isolation = recipients.every(
    (r, i) => JSON.stringify(r.counts) === before[i],
  );
  const revoked = recipients.find(
      (r) => r.role === 'OWNER' && topics[r.topicIndex].tenant === 0,
    ),
    survivor = recipients.find(
      (r) =>
        r !== revoked &&
        r.topicIndex === revoked.topicIndex &&
        r.actor !== revoked.actor,
    );
  for (const recipient of recipients.filter((r) => r.actor === revoked.actor)) {
    recipient.allowed = false;
    recipient.expectedClose = 'revocation';
  }
  identities.revoke(revoked.actor);
  const previousSurvivor = survivor.counts.order_ready ?? 0;
  await publish(0, 'order_ready');
  await until(
    () =>
      revoked.closed && survivor.counts.order_ready === previousSurvivor + 1,
    'independent revocation',
  );
  report.controls.revocation = true;
  // A real leave/rejoin on an otherwise unshared upstream topic, with resync.
  const reconnect = recipients.find(
    (r) => r.apiIndex === 2 && r.role === 'CUSTOMER' && !r.closed,
  );
  const channelBefore = providers[2].channels.size;
  reconnect.expectedClose = 'churn';
  reconnect.request.destroy();
  await until(
    () => reconnect.closed && providers[2].channels.size === channelBefore - 1,
    'upstream leave',
  );
  const replacement = addRecipient(
    2,
    reconnect.topicIndex,
    reconnect.role,
    false,
  );
  connect(replacement, port);
  await until(
    () =>
      replacement.counts.resync === 1 &&
      providers[2].channels.size === channelBefore,
    'upstream rejoin',
  );
  await delivered(reconnect.topicIndex, 'order_completed');
  report.controls.reconnect = true;
  // Rapid bursts intentionally coalesce to resync rather than promise every delta.
  const coalesced = recipients.filter(
      (r) => !r.closed && r.allowed && r.topicIndex === 3,
    ),
    prior = coalesced.map((r) => r.counts.resync ?? 0);
  let release;
  const gate = new Promise((done) => {
    release = done;
  });
  for (const recipient of coalesced) recipient.authGate = gate;
  const beforeBurst = providers.map(
    (provider) => provider.received.get(topics[3].topic) ?? 0,
  );
  try {
    await Promise.all(
      Array.from({ length: 10 }, () => publish(3, 'order_ready')),
    );
    await until(
      () =>
        providers.every(
          (provider, i) =>
            !provider.channels.has(topics[3].topic) ||
            (provider.received.get(topics[3].topic) ?? 0) >=
              beforeBurst[i] + 10,
        ),
      'upstream burst arrival',
    );
  } finally {
    release();
    for (const recipient of coalesced) recipient.authGate = undefined;
  }
  await until(
    () => coalesced.every((r, i) => (r.counts.resync ?? 0) > prior[i]),
    'coalesced resync',
  );
  report.controls.coalescing = true;
  await delivered(3, 'order_completed');
  report.controls.recovery = true;
  report.controls.multiplex = channelCount() === 18;
  async function interrupt(apiIndexes, topicIndex) {
    const affected = recipients.filter(
        (r) => !r.closed && r.allowed && apiIndexes.includes(r.apiIndex),
      ),
      beforeResync = affected.map((r) => r.counts.resync ?? 0);
    for (const api of apiIndexes) providers[api].pause();
    await until(
      () =>
        apiIndexes.every((api) =>
          [...providers[api].channels.keys()].every(
            (topic) => providers[api].state.connected.get(topic) === false,
          ),
        ),
      'wire interruption',
    );
    const offline = affected.filter((r) => r.topicIndex === topicIndex),
      beforeOffline = offline.map((r) => r.counts.order_completed ?? 0);
    const healthy = recipients.filter(
        (r) =>
          !r.closed &&
          r.allowed &&
          !apiIndexes.includes(r.apiIndex) &&
          r.topicIndex === topicIndex,
      ),
      beforeHealthy = healthy.map((r) => r.counts.order_completed ?? 0);
    await publish(topicIndex, 'order_completed');
    if (healthy.length)
      await reconcile(healthy, beforeHealthy, 'order_completed');
    await sleep(100);
    assert.ok(
      offline.length > 0 &&
        offline.every(
          (r, i) => (r.counts.order_completed ?? 0) === beforeOffline[i],
        ),
      'Offline delivery accounting mismatch.',
    );
    report.delivery.expectedOfflineDrops += offline.length;
    for (const api of apiIndexes) providers[api].resume();
    await until(
      () =>
        affected.every((r, i) => (r.counts.resync ?? 0) > beforeResync[i]) &&
        apiIndexes.every((api) =>
          [...providers[api].channels.keys()].every(
            (topic) => providers[api].state.connected.get(topic) === true,
          ),
        ),
      'automatic wire reconnect',
    );
    for (const api of apiIndexes) providers[api].state.faulting = false;
    await recoveredReads();
  }
  await interrupt([0], 0);
  report.controls.networkRecovery = true;
  await interrupt([0, 1, 2], 3);
  report.controls.reconnectStorm = true;
  const churn = ['CUSTOMER', 'OWNER', 'CASHIER', 'KITCHEN'].map((role) =>
    recipients.find((r) => r.role === role && !r.closed && r.allowed),
  );
  for (const r of churn) {
    r.expectedClose = 'churn';
    r.request.destroy();
  }
  await until(() => churn.every((r) => r.closed), 'browser disconnect cohort');
  const rejoined = churn.map((r) =>
    addRecipient(r.apiIndex, r.topicIndex, r.role, false),
  );
  for (const r of rejoined) {
    await sleep(15 + (r.index % 4) * 10);
    connect(r, port);
  }
  await until(
    () => rejoined.every((r) => r.counts.resync > 0),
    'browser reconnect cohort',
  );
  await recoveredReads();
  report.controls.browserChurn = true;
  // Deterministic writable-backpressure probe of the same production relay.
  class Slow extends EventEmitter {
    destroyed = false;
    headersSent = false;
    setHeader() {}
    flushHeaders() {
      this.headersSent = true;
    }
    write() {
      return false;
    }
    end() {
      this.ended = true;
    }
  }
  const slow = new Slow();
  await services[0].relay(
    topics[0].topic,
    eventNames,
    topics[0].scope,
    async () => {},
    slow,
  );
  await until(() => slow.ended === true, 'slow consumer close');
  report.controls.slowConsumer = true;
  report.supabaseVerified = mode === 'hosted';
  report.databaseVerified = mode === 'hosted';
} catch (error) {
  failure = error;
  report.failure = {
    code: 'FANOUT_CHECK_FAILED',
    step: currentStep,
    dependencyCode:
      typeof error.code === 'string' && /^[A-Z0-9_]{3,40}$/.test(error.code)
        ? error.code
        : undefined,
  };
} finally {
  cleaning = true;
  for (const request of requests) request.destroy();
  for (const socket of sockets) socket.destroy();
  const cleanup = await Promise.allSettled(
    services.map((service) => service.onModuleDestroy()),
  );
  if (publisher) {
    await publisher.removeAllChannels();
    await publisher.realtime.disconnect();
  }
  if (server) await new Promise((done) => server.close(done));
  for (let i = 0; i < 100 && (requests.size || sockets.size); i++)
    await sleep(10);
  clearInterval(resourceTimer);
  sample();
  lag.disable();
  report.publishes = broadcasts;
  report.providerErrors = providerErrors;
  report.invalidFrames = recipients.reduce((n, r) => n + r.invalidFrames, 0);
  report.elapsedMs = performance.now() - started;
  report.authorization = identities?.counters;
  if (databaseFixture) {
    report.database = databaseFixture.stats;
    try {
      report.databaseCleanup = await databaseFixture.close();
    } catch {
      report.databaseCleanup = false;
    }
  }
  report.elapsedMs = performance.now() - started;
  report.cleanup = {
    streamsClosed: requests.size === 0 && sockets.size === 0,
    channelsRemoved:
      cleanup.every((r) => r.status === 'fulfilled') && channelCount() === 0,
    serverClosed: !server?.listening,
    temporaryDatabaseObjectsRemoved:
      mode === 'local' || report.databaseCleanup === true,
  };
  Object.assign(report, evaluateFanout(report));
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(
  JSON.stringify({
    pass: report.pass,
    mode: report.mode,
    supabaseVerified: report.supabaseVerified,
    checks: report.checks,
  }),
);
if (failure || !report.pass)
  throw new Error('Fan-out check failed; see aggregate report.');
