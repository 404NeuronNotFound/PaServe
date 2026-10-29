import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { performance } from 'node:perf_hooks';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { configureTrustedProxy } from '../src/common/http/trusted-proxy.js';
import { resetRateLimits } from './rate-limit-test-utils.js';

describe('login flood isolation', () => {
  let app: NestExpressApplication;
  let now = 0;
  const login = vi.fn();
  const register = vi.fn();
  const currentUser = vi.fn();
  const refresh = vi.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue({ login, register, currentUser, refresh })
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');
    configureTrustedProxy(app, '127.0.0.1/32,::1/128');
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    resetRateLimits(app);
    login.mockReset().mockRejectedValue(
      new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials.',
      }),
    );
    register.mockReset().mockResolvedValue({});
    refresh.mockReset().mockRejectedValue(new UnauthorizedException());
    currentUser.mockReset().mockResolvedValue({ id: 'owner' });
  });
  afterEach(() => vi.restoreAllMocks());
  const attempt = (ip: number, email = 'owner@example.com', path = 'login') =>
    request(app.getHttpServer())
      .post(`/api/v1/auth/${path}`)
      .set('X-Forwarded-For', `192.0.2.${ip}`)
      .set('X-PaServe-Client', 'web')
      .send({ email, password: 'a long valid password' });

  it('keeps normalized-account enforcement source-scoped so distributed failures cannot block a clean victim', async () => {
    for (let i = 1; i <= 20; i++) {
      now = i * 1100;
      await attempt(
        i,
        i % 2 ? ' OWNER@example.com ' : 'owner@example.com',
      ).expect(401);
    }
    await attempt(21).expect(401);
    expect(login).toHaveBeenCalledTimes(21);
    login.mockResolvedValueOnce({
      refreshToken: 'synthetic-victim-refresh',
      expiresAt: new Date(Date.now() + 60000),
      keepSignedIn: false,
      response: {
        accessToken: 'synthetic-victim-access',
        user: { id: 'victim' },
      },
    });
    const victim = await attempt(99).expect(200);
    expect(victim.body.user.id).toBe('victim');
    expect(victim.headers['set-cookie']).toBeDefined();
    await attempt(22, 'another@example.com').expect(401);
    now = 62_000;
    await attempt(23).expect(401);
  });

  it('bounds distributed credential stuffing and shares the budget with registration', async () => {
    for (let i = 1; i <= 10; i++)
      await attempt(i, `user${i}@example.com`).expect(401);
    await attempt(11, 'fresh@example.com').expect(429);
    await attempt(12, 'new@example.com', 'register').expect(429);
    expect(login).toHaveBeenCalledTimes(10);
    expect(register).not.toHaveBeenCalled();
    now = 1000;
    await attempt(13, 'fresh@example.com').expect(401);
  });

  it('rejects concurrent overflow immediately while existing sessions and unrelated API work proceed', async () => {
    const pending: (() => void)[] = [];
    login.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          pending.push(() => reject(new UnauthorizedException()));
        }),
    );
    const first = attempt(1).then((value) => value);
    const second = attempt(2, 'other@example.com').then((value) => value);
    try {
      await vi.waitFor(() => expect(pending).toHaveLength(2));
      const busy = await attempt(3, 'real@example.com').expect(429);
      expect(busy.body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(busy.headers['retry-after']).toBe('1');
      expect(login).toHaveBeenCalledTimes(2);
      await request(app.getHttpServer()).get('/api/v1').expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer existing-session')
        .expect(200);
    } finally {
      pending.forEach((finish) => finish());
      await Promise.all([first, second]);
    }
    login.mockRejectedValue(new UnauthorizedException());
    await attempt(4).expect(401);
  });

  it('releases work after DTO validation failures and rejects bad origins before admission', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({})
      .expect(403);
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-PaServe-Client', 'web')
        .send({ email: [] })
        .expect(400);
    }
    await attempt(5).expect(401);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it.each(['/auth/forgot-password', '/auth/reset-password'])(
    'keeps unimplemented password recovery unavailable: %s',
    async (path) => {
      await request(app.getHttpServer())
        .post(`/api/v1${path}`)
        .send({ email: 'owner@example.com' })
        .expect(404);
      expect(login).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['login', 10, 5, 401],
    ['register', 5, 2, 201],
    ['refresh', 30, 10, 401],
  ] as const)(
    'keeps the minute budget after multiple short bursts for %s',
    async (path, limit, burst, status) => {
      const base = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => base + now);
      const send = () =>
        path === 'refresh'
          ? request(app.getHttpServer())
              .post('/api/v1/auth/refresh')
              .set('X-PaServe-Client', 'web')
              .set('Cookie', 'paserve_refresh=invalid')
              .send({})
          : attempt(100, 'minute@example.com', path);
      for (let i = 0; i < limit; i++) {
        now = Math.floor(i / burst) * 10_001;
        await send().expect(status);
      }
      now = Math.ceil(limit / burst) * 10_001;
      const blocked = await send().expect(429);
      expect(Number(blocked.headers['retry-after'])).toBe(
        Math.ceil((60_000 - now) / 1000),
      );
    },
  );

  it.each([
    ['login', 5, 401],
    ['register', 2, 201],
    ['refresh', 10, 401],
  ] as const)(
    'enforces a short burst and retry for %s',
    async (path, limit, status) => {
      const send = () =>
        path === 'refresh'
          ? request(app.getHttpServer())
              .post('/api/v1/auth/refresh')
              .set('X-PaServe-Client', 'web')
              .set('Cookie', 'paserve_refresh=invalid')
              .send({})
          : attempt(100, 'burst@example.com', path);
      for (let i = 0; i < limit; i++) await send().expect(status);
      const blocked = await send().expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(10);
    },
  );

  it.each([
    ['login', 50, 12_100, 401],
    ['register', 20, 30_100, 201],
    ['refresh', 180, 3100, 401],
  ] as const)(
    'enforces the rolling fifteen-minute budget for %s and recovers without extending it',
    async (path, limit, interval, status) => {
      const base = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => base + now);
      const send = () =>
        path === 'refresh'
          ? request(app.getHttpServer())
              .post('/api/v1/auth/refresh')
              .set('X-PaServe-Client', 'web')
              .set('Cookie', 'paserve_refresh=invalid')
              .send({})
          : attempt(100, 'sustained@example.com', path);
      for (let i = 0; i < limit; i++) {
        now = i * interval;
        await send().expect(status);
      }
      now = limit * interval;
      const blocked = await send().expect(429);
      expect(Number(blocked.headers['retry-after'])).toBe(
        Math.ceil((900_000 - now) / 1000),
      );
      const calls = (
        path === 'login' ? login : path === 'register' ? register : refresh
      ).mock.calls.length;
      expect(calls).toBe(limit);
      now = 900_001;
      await send().expect(status);
    },
  );
});
