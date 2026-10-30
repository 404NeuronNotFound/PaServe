import assert from 'node:assert/strict';
import { validateFanoutDatabase } from './realtime-fanout.database.mjs';

export const fanoutProfile = Object.freeze({
  version: 2,
  levels: [6, 18, 24],
  apiInstances: 3,
  topics: 9,
  p95Ms: 2000,
  p99Ms: 5000,
  maxPublishes: 100,
  deadlineMs: 55000,
});

// Explicit JSON file only; never loads dotenv, inherited URLs or production targets.
export function hostedFanoutSettings(value, expectedRef, runApproved) {
  assert.equal(
    runApproved,
    '--run-disposable',
    'Hosted traffic requires --run-disposable.',
  );
  assert.match(
    expectedRef ?? '',
    /^[a-z0-9]{20}$/,
    'Specify the expected disposable project reference.',
  );
  assert.equal(value.environment, 'disposable-staging');
  assert.equal(value.projectRef, expectedRef);
  const url = new URL(value.supabaseUrl);
  assert.equal(url.href, `https://${expectedRef}.supabase.co/`);
  assert.equal(typeof value.serviceRoleKey, 'string');
  assert.ok(
    value.serviceRoleKey.length >= 32,
    'A backend service-role key is required.',
  );
  if (value.serviceRoleKey.startsWith('sb_secret_'))
    assert.ok(value.serviceRoleKey.length > 40);
  else {
    let claims;
    try {
      claims = JSON.parse(
        Buffer.from(value.serviceRoleKey.split('.')[1], 'base64url').toString(
          'utf8',
        ),
      );
    } catch {
      throw new Error('Backend service-role key format is invalid.');
    }
    assert.equal(
      claims.role,
      'service_role',
      'A browser anon key cannot run this test.',
    );
    if (claims.ref) assert.equal(claims.ref, expectedRef);
  }
  assert.equal(value.allowFixtureBroadcasts, true);
  assert.equal(value.allowTemporaryDatabaseFixtures, true);
  const databaseUrl = validateFanoutDatabase(value.databaseUrl, expectedRef);
  return {
    url: url.origin,
    key: value.serviceRoleKey,
    databaseUrl,
    projectRef: expectedRef,
  };
}

export function evaluateFanout(report) {
  const checks = {
    noFailure:
      !report.failure &&
      report.providerErrors === 0 &&
      report.invalidFrames === 0,
    provider:
      report.mode === 'disposable-supabase-broadcast'
        ? report.supabaseVerified === true
        : report.mode === 'controlled-local-relay' &&
          report.supabaseVerified === false,
    stages:
      report.stages.length === 3 &&
      report.stages.every(
        (s, i) =>
          s.clients === fanoutProfile.levels[i] &&
          s.upstreamChannels === [6, 15, 18][i] &&
          s.deliveries === s.clients &&
          s.expectedDeliveries === s.clients &&
          s.dropped === 0 &&
          s.invalidFrames === 0 &&
          Number.isFinite(s.p95Ms) &&
          s.p95Ms <= fanoutProfile.p95Ms &&
          Number.isFinite(s.p99Ms) &&
          s.p99Ms <= fanoutProfile.p99Ms,
      ),
    isolation: report.controls?.isolation === true,
    revocation: report.controls?.revocation === true,
    recovery: report.controls?.recovery === true,
    reconnect: report.controls?.reconnect === true,
    coalescing: report.controls?.coalescing === true,
    slowConsumer: report.controls?.slowConsumer === true,
    multiplex: report.controls?.multiplex === true,
    roles:
      report.controls?.roles === true &&
      ['CUSTOMER', 'CASHIER', 'KITCHEN', 'OWNER'].every(
        (role) =>
          report.roles?.[role]?.subscribers === 6 &&
          report.roles[role].deliveries > 0,
      ) &&
      Object.values(report.authorizationMatrix ?? {}).length === 8 &&
      Object.values(report.authorizationMatrix ?? {}).every(
        (value) => value === true,
      ),
    database:
      report.mode === 'controlled-local-relay'
        ? report.databaseVerified === false
        : report.databaseVerified === true &&
          report.database?.transitions === 9 &&
          report.database?.rollbacks === 1 &&
          report.cleanup?.temporaryDatabaseObjectsRemoved === true,
    disconnects:
      report.delivery?.expected > 0 &&
      report.delivery.expected === report.delivery.received &&
      report.delivery?.dropped === 0 &&
      report.delivery?.unexpectedSseClosures === 0 &&
      report.delivery?.unexpectedWireClosures === 0 &&
      report.delivery?.unexpectedChannelClosures === 0 &&
      report.delivery?.expectedWireClosures >= 4 &&
      report.delivery?.expectedChannelInterruptions > 0 &&
      report.delivery?.channelRejoins > 0 &&
      report.delivery?.expectedOfflineDrops > 0,
    networkRecovery:
      report.controls?.networkRecovery === true &&
      report.controls?.reconnectStorm === true &&
      report.controls?.browserChurn === true,
    cleanup:
      report.cleanup?.streamsClosed === true &&
      report.cleanup?.channelsRemoved === true &&
      report.cleanup?.serverClosed === true,
    bounded:
      report.publishes > 0 &&
      report.publishes <= fanoutProfile.maxPublishes &&
      report.elapsedMs <= fanoutProfile.deadlineMs,
    observed:
      report.resources?.length >= 6 &&
      report.resources.every(
        (s) =>
          Number.isFinite(s.rssBytes) && Number.isFinite(s.cpuCoreEquivalent),
      ),
  };
  return { pass: Object.values(checks).every(Boolean), checks };
}
