import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hostedFanoutSettings,
  evaluateFanout,
} from './realtime-fanout.settings.mjs';
import { validateFanoutDatabase } from './realtime-fanout.database.mjs';
const ref = 'a'.repeat(20);
const key = (role = 'service_role', project = ref) =>
  `header.${Buffer.from(JSON.stringify({ role, ref: project })).toString('base64url')}.synthetic-not-a-real-signature`;
const settings = () => ({
  environment: 'disposable-staging',
  projectRef: ref,
  supabaseUrl: `https://${ref}.supabase.co`,
  serviceRoleKey: key(),
  allowFixtureBroadcasts: true,
  allowTemporaryDatabaseFixtures: true,
  databaseUrl: `postgresql://postgres.${ref}:synthetic@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`,
});
await test('hosted run requires matching explicit disposable project, backend key and approval', () =>
  assert.equal(
    hostedFanoutSettings(settings(), ref, '--run-disposable').url,
    `https://${ref}.supabase.co`,
  ));
for (const [label, mutate] of [
  [
    'production environment',
    (s) => {
      s.environment = 'production';
    },
  ],
  [
    'different project',
    (s) => {
      s.projectRef = 'b'.repeat(20);
    },
  ],
  [
    'different URL',
    (s) => {
      s.supabaseUrl = 'https://production.example.com';
    },
  ],
  [
    'redirect-like path',
    (s) => {
      s.supabaseUrl += '/realtime';
    },
  ],
  [
    'missing fixture approval',
    (s) => {
      s.allowFixtureBroadcasts = false;
    },
  ],
  [
    'browser anon key',
    (s) => {
      s.serviceRoleKey = key('anon');
    },
  ],
  [
    'foreign project key',
    (s) => {
      s.serviceRoleKey = key('service_role', 'b'.repeat(20));
    },
  ],
  [
    'malformed secret',
    (s) => {
      s.serviceRoleKey = 'not-a-real-key'.repeat(5);
    },
  ],
])
  await test(`refuses ${String(label)} before network access`, () => {
    const s = settings();
    mutate(s);
    assert.throws(() => hostedFanoutSettings(s, ref, '--run-disposable'));
  });
await test('inherited environment cannot replace missing explicit arguments', () => {
  assert.throws(() =>
    hostedFanoutSettings(settings(), undefined, '--run-disposable'),
  );
  assert.throws(() => hostedFanoutSettings(settings(), ref, undefined));
});
for (const databaseUrl of [
  `postgresql://postgres.${'b'.repeat(20)}:synthetic@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}:synthetic@production.example.com:5432/postgres`,
  `postgresql://postgres.${ref}:synthetic@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${ref}:synthetic@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?host=production.example.com`,
])
  await test('rejects unsafe or transaction-pooled database targets before connection', () =>
    assert.throws(() => validateFanoutDatabase(databaseUrl, ref)));
function fixture() {
  return {
    mode: 'disposable-supabase-broadcast',
    supabaseVerified: true,
    databaseVerified: true,
    database: { transitions: 9, rollbacks: 1 },
    roles: Object.fromEntries(
      ['CUSTOMER', 'OWNER', 'CASHIER', 'KITCHEN'].map((role) => [
        role,
        { subscribers: 6, deliveries: 1 },
      ]),
    ),
    authorizationMatrix: Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [i, true]),
    ),
    delivery: {
      dropped: 0,
      unexpectedSseClosures: 0,
      unexpectedWireClosures: 0,
      expectedOfflineDrops: 1,
      expected: 1,
      received: 1,
      unexpectedChannelClosures: 0,
      expectedWireClosures: 4,
      expectedChannelInterruptions: 1,
      channelRejoins: 1,
    },
    providerErrors: 0,
    invalidFrames: 0,
    stages: [6, 18, 24].map((clients, i) => ({
      clients,
      upstreamChannels: [6, 15, 18][i],
      deliveries: clients,
      expectedDeliveries: clients,
      dropped: 0,
      invalidFrames: 0,
      p95Ms: 50,
      p99Ms: 100,
    })),
    controls: Object.fromEntries(
      [
        'isolation',
        'revocation',
        'recovery',
        'reconnect',
        'coalescing',
        'slowConsumer',
        'multiplex',
        'roles',
        'networkRecovery',
        'reconnectStorm',
        'browserChurn',
      ].map((k) => [k, true]),
    ),
    cleanup: {
      streamsClosed: true,
      channelsRemoved: true,
      serverClosed: true,
      temporaryDatabaseObjectsRemoved: true,
    },
    publishes: 69,
    elapsedMs: 10000,
    resources: Array.from({ length: 6 }, () => ({
      rssBytes: 1000,
      cpuCoreEquivalent: 1,
    })),
  };
}
await test('accepts complete measured hosted evidence', () =>
  assert.equal(evaluateFanout(fixture()).pass, true));
for (const [label, mutate] of [
  [
    'missing owner coverage',
    (r) => {
      r.roles.OWNER.subscribers = 0;
    },
  ],
  [
    'unreconciled expected counts',
    (r) => {
      r.delivery.received = 0;
    },
  ],
  [
    'unexpected channel closure',
    (r) => {
      r.delivery.unexpectedChannelClosures = 1;
    },
  ],
  [
    'missing channel rejoins',
    (r) => {
      r.delivery.channelRejoins = 0;
    },
  ],
  [
    'role authorization bypass',
    (r) => {
      r.authorizationMatrix[0] = false;
    },
  ],
  [
    'unverified DB triggers',
    (r) => {
      r.databaseVerified = false;
    },
  ],
  [
    'missing committed updates',
    (r) => {
      r.database.transitions = 0;
    },
  ],
  [
    'missing DB cleanup',
    (r) => {
      r.cleanup.temporaryDatabaseObjectsRemoved = false;
    },
  ],
  [
    'unplanned SSE loss',
    (r) => {
      r.delivery.unexpectedSseClosures = 1;
    },
  ],
  [
    'unplanned wire loss',
    (r) => {
      r.delivery.unexpectedWireClosures = 1;
    },
  ],
  [
    'unreconciled missing frames',
    (r) => {
      r.delivery.dropped = 1;
    },
  ],
  [
    'no network interruption',
    (r) => {
      r.controls.networkRecovery = false;
    },
  ],
  [
    'no reconnect storm',
    (r) => {
      r.controls.reconnectStorm = false;
    },
  ],
  [
    'unverified Supabase',
    (r) => {
      r.supabaseVerified = false;
    },
  ],
  [
    'provider errors',
    (r) => {
      r.providerErrors = 1;
    },
  ],
  [
    'invalid frames after a plateau',
    (r) => {
      r.invalidFrames = 1;
    },
  ],
  [
    'missing deliveries',
    (r) => {
      r.stages[2].deliveries--;
    },
  ],
  [
    'wrong multiplexing',
    (r) => {
      r.stages[2].upstreamChannels = 24;
    },
  ],
  [
    'slow p95',
    (r) => {
      r.stages[2].p95Ms = 2001;
    },
  ],
  [
    'missing resource samples',
    (r) => {
      r.resources = [];
    },
  ],
  [
    'open sockets',
    (r) => {
      r.cleanup.streamsClosed = false;
    },
  ],
  [
    'failed channel cleanup',
    (r) => {
      r.cleanup.channelsRemoved = false;
    },
  ],
  [
    'too many publications',
    (r) => {
      r.publishes = 101;
    },
  ],
  [
    'expired deadline',
    (r) => {
      r.elapsedMs = 55001;
    },
  ],
  [
    'missed resync',
    (r) => {
      r.controls.coalescing = false;
    },
  ],
])
  await test(`rejects ${String(label)}`, () => {
    const r = fixture();
    mutate(r);
    assert.equal(evaluateFanout(r).pass, false);
  });
