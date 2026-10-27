// Private child process for local HTTP capacity checks. No real database/provider.
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { stat } from 'node:fs/promises';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { AppModule } from '../dist/app.module.js';
import { AuthRepository } from '../dist/modules/auth/auth.repository.js';
import {
  PasswordHashService,
  PASSWORD_HASH_POLICY,
} from '../dist/modules/auth/password-hash.service.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { configureTrustedProxy } from '../dist/common/http/trusted-proxy.js';
import { configureRequestBody } from '../dist/common/http/request-body.js';
import { configureSecurityHeaders } from '../dist/common/http/security-headers.js';

if (!process.send)
  throw new Error('Run this private fixture through test:hash-login-flood');
const password = 'Disposable local HTTP capacity fixture password';
const shop = {
  id: '20000000-0000-4000-8000-000000000001',
  name: 'Capacity Cafe',
  slug: 'capacity-cafe',
  isActive: true,
  logoUrl: null,
};
const users = ['OWNER', 'CASHIER', 'ATTACKER'].map((role, index) => ({
  id: `10000000-0000-4000-8000-00000000000${index + 1}`,
  email: `${role.toLowerCase()}@capacity.example.invalid`,
  passwordHash: '',
  isActive: true,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  firstName: null,
  lastName: null,
  memberships:
    role === 'ATTACKER'
      ? []
      : [{ id: `membership-${role}`, shopId: shop.id, role, shop }],
}));
const sessions = new Map();
const activity = {
  loginReads: 0,
  attackerLoginReads: 0,
  sessionReads: 0,
  menuReads: 0,
  sessionWrites: 0,
  attackerSessionWrites: 0,
};
let externalFetchAttempts = 0;
globalThis.fetch = async () => {
  externalFetchAttempts++;
  throw new Error('External fetch is forbidden in the local capacity fixture');
};
const repository = {
  async findLoginAccount(email) {
    activity.loginReads++;
    if (email.startsWith('attacker@') || email.startsWith('missing@'))
      activity.attackerLoginReads++;
    return users.find((user) => user.email === email) ?? null;
  },
  async createSession(id, userId, refreshTokenHash, expiresAt, verifiedHash) {
    const user = users.find(
      (entry) => entry.id === userId && entry.passwordHash === verifiedHash,
    );
    if (!user) throw new Error('Fixture credential mismatch');
    activity.sessionWrites++;
    if (user === users[2]) activity.attackerSessionWrites++;
    sessions.set(id, {
      id,
      userId,
      refreshTokenHash,
      expiresAt,
      revokedAt: null,
    });
    return { id: userId };
  },
  async findSession(id, userId) {
    activity.sessionReads++;
    const session = sessions.get(id);
    const user = users.find((entry) => entry.id === userId);
    return session &&
      user?.isActive &&
      session.userId === userId &&
      !session.revokedAt &&
      session.expiresAt > new Date()
      ? { ...session, user }
      : null;
  },
};
const database = {
  shop: {
    async findFirst(query) {
      if (query.where.slug !== shop.slug || query.where.isActive !== true)
        throw new Error('Unexpected fixture shop scope');
      activity.menuReads++;
      if (query.select.id) return { id: shop.id };
      if (
        query.where.id !== shop.id ||
        query.select.products.where.shopId !== shop.id
      )
        throw new Error('Missing fixture tenant predicate');
      return {
        name: shop.name,
        slug: shop.slug,
        description: null,
        logoUrl: null,
        bannerUrl: null,
        primaryColor: null,
        accentColor: null,
        menuLayout: 'grid',
        categories: [],
        products: [
          {
            id: '30000000-0000-4000-8000-000000000001',
            categoryId: null,
            name: 'Coffee',
            slug: 'coffee',
            description: null,
            price: new Prisma.Decimal('4.50'),
            imageUrl: null,
            status: 'AVAILABLE',
            isFeatured: false,
            featuredSortOrder: null,
            sortOrder: 0,
          },
        ],
      };
    },
  },
};
let app, passwords, measurement, sampleTimer, eventLoop;
let fsPending = Promise.resolve();
let fsBusy = false;
function poolProbe() {
  const activeAtStart = passwords.snapshot().active;
  const start = performance.now();
  return stat(new URL('../package.json', import.meta.url)).then(() => ({
    ms: performance.now() - start,
    activeAtStart,
  }));
}
function begin() {
  if (measurement) throw new Error('Measurement already active');
  const started = performance.now();
  measurement = {
    started,
    cpu: process.cpuUsage(),
    lastCpu: process.cpuUsage(),
    lastTime: started,
    nativeBefore: passwords.snapshot(),
    samples: [],
    fs: [],
    fsFailures: 0,
    fsMissed: 0,
    activityBefore: { ...activity },
    overlapRequests: 0,
    observedAttackPeer: false,
    observedLegitimatePeer: false,
  };
  eventLoop = monitorEventLoopDelay({ resolution: 10 });
  eventLoop.enable();
  sampleTimer = setInterval(() => {
    const state = measurement;
    if (!state) return;
    const now = performance.now();
    const cpu = process.cpuUsage(state.lastCpu);
    const native = passwords.snapshot();
    state.samples.push({
      elapsedMs: Math.round(now - started),
      cpuCoreEquivalent:
        Math.round((cpu.user + cpu.system) / (now - state.lastTime) / 10) / 100,
      rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      activeHashJobs: native.active,
      reservedKiB: native.reservedKiB,
    });
    state.lastCpu = process.cpuUsage();
    state.lastTime = now;
    if (fsBusy) {
      state.fsMissed++;
      return;
    }
    fsBusy = true;
    fsPending = poolProbe()
      .then(
        (sample) => state.fs.push(sample),
        () => {
          state.fsFailures++;
        },
      )
      .finally(() => {
        fsBusy = false;
      });
  }, 50);
}
async function finish() {
  clearInterval(sampleTimer);
  await fsPending;
  eventLoop.disable();
  const state = measurement;
  const elapsedMs = performance.now() - state.started;
  const cpu = process.cpuUsage(state.cpu);
  const after = passwords.snapshot();
  measurement = undefined;
  return {
    elapsedMs: Math.round(elapsedMs),
    cpuCoreEquivalent:
      Math.round((cpu.user + cpu.system) / elapsedMs / 10) / 100,
    cpuSamples: state.samples,
    eventLoopP95Ms: Math.round(eventLoop.percentile(95) / 10_000) / 100,
    fsProbes: state.fs,
    fsFailures: state.fsFailures,
    fsMissed: state.fsMissed,
    overlapRequests: state.overlapRequests,
    distinctSocketPeersObserved:
      state.observedAttackPeer && state.observedLegitimatePeer,
    native: {
      ...after,
      measuredVerifyJobs: after.verifyJobs - state.nativeBefore.verifyJobs,
    },
    activity: Object.fromEntries(
      Object.entries(activity).map(([key, value]) => [
        key,
        value - state.activityBefore[key],
      ]),
    ),
    externalFetchAttempts,
  };
}
async function initialize() {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(database)
    .overrideProvider(AuthRepository)
    .useValue(repository)
    .overrideProvider(ConfigService)
    .useValue(
      new ConfigService({
        NODE_ENV: 'test',
        FRONTEND_ORIGINS: 'http://localhost',
        JWT_ACCESS_SECRET: 'local-capacity-access-fixture-only-secret',
        JWT_REFRESH_SECRET: 'local-capacity-refresh-fixture-only-secret',
        AUTH_BOT_CHALLENGE_ENABLED: 'true',
        TURNSTILE_SECRET_KEY: 'local-unused-challenge-fixture-secret',
        TURNSTILE_HOSTNAMES: 'localhost',
        AUTH_MAX_CONCURRENT: '2',
        AUTH_ATTEMPTS_PER_MINUTE: '60',
        AUTH_HASH_MAX_CONCURRENT: String(
          Math.min(2, Number(process.env.UV_THREADPOOL_SIZE ?? 4) - 1),
        ),
        AUTH_HASH_MEMORY_MB: '128',
      }),
    )
    .compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  configureSecurityHeaders(app, false);
  configureTrustedProxy(app, '');
  configureRequestBody(app);
  passwords = app.get(PasswordHashService);
  app.use((request, response, next) => {
    if (measurement) {
      const peer = request.socket.remoteAddress;
      if (peer === '127.0.0.2') measurement.observedAttackPeer = true;
      else if (['127.0.0.3', '127.0.0.4', '127.0.0.5'].includes(peer)) {
        measurement.observedLegitimatePeer = true;
        const active = passwords.snapshot().active;
        response.setHeader('X-Capacity-Fixture-Hash-Jobs', active);
        if (active > 0) measurement.overlapRequests++;
      }
    }
    next();
  });
  await app.init();
  for (const user of users) user.passwordHash = await passwords.hash(password);
  await app.listen(0, '127.0.0.1');
  process.send({
    type: 'ready',
    port: app.getHttpServer().address().port,
    policy: PASSWORD_HASH_POLICY,
    concurrency: passwords.maxConcurrent,
    configuredThreadpoolSize: Number(process.env.UV_THREADPOOL_SIZE ?? 4),
    memoryBudgetKiB: passwords.memoryBudgetKiB,
  });
}
process.on('message', async (message) => {
  try {
    let value;
    if (message.type === 'begin') {
      begin();
      value = true;
    } else if (message.type === 'inspect') value = passwords.snapshot();
    else if (message.type === 'poolProbe') value = await poolProbe();
    else if (message.type === 'finish') value = await finish();
    else if (message.type === 'stop') {
      clearInterval(sampleTimer);
      if (measurement) await fsPending;
      await app.close();
      process.send({ id: message.id, value: true }, () => process.exit(0));
      return;
    } else throw new Error('Unknown fixture command');
    process.send({ id: message.id, value });
  } catch {
    process.send({
      id: message.id,
      error: 'Local capacity fixture command failed',
    });
  }
});
process.on('disconnect', () => {
  clearInterval(sampleTimer);
  void app?.close().finally(() => process.exit(0));
});
initialize().catch(() => {
  process.send(
    { type: 'fatal', error: 'Local capacity fixture initialization failed' },
    () => process.exit(1),
  );
});
