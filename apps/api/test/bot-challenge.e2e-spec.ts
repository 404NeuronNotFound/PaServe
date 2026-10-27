import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { performance } from 'node:perf_hooks';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { configureTrustedProxy } from '../src/common/http/trusted-proxy.js';
import { resetRateLimits } from './rate-limit-test-utils.js';

describe('progressive authentication challenge HTTP boundary', () => {
  let app: NestExpressApplication;
  let now = 0;
  const login = vi.fn();
  const register = vi.fn();
  const provider = vi.fn();
  const success = {
    response: { user: { id: 'u' }, accessToken: 'access' },
    refreshToken: 'refresh',
    expiresAt: new Date(Date.now() + 60_000),
    keepSignedIn: false,
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue({ login, register })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          NODE_ENV: 'test',
          AUTH_BOT_CHALLENGE_ENABLED: 'true',
          TURNSTILE_SECRET_KEY: 'test-secret',
          TURNSTILE_HOSTNAMES: 'app.example.test',
        }),
      )
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
    vi.spyOn(Date, 'now').mockImplementation(() => 1_800_000_000_000 + now);
    vi.stubGlobal('fetch', provider);
    resetRateLimits(app);
    login.mockReset().mockRejectedValue(
      new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials.',
      }),
    );
    register
      .mockReset()
      .mockResolvedValue({ message: 'Generic acknowledgement.' });
    provider.mockReset().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        action: 'login',
        hostname: 'app.example.test',
        challenge_ts: new Date(Date.now()).toISOString(),
      }),
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const post = (
    ip: number,
    email = 'owner@example.test',
    token?: string,
    path = 'login',
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/auth/${path}`)
      .set('X-Forwarded-For', `192.0.2.${ip}`)
      .set('X-PaServe-Client', 'web')
      .send({
        email,
        password: 'valid password fixture',
        ...(token ? { challengeToken: token } : {}),
      });
  const failThree = async () => {
    for (let i = 0; i < 3; i++) {
      now += 2000;
      await post(1).expect(401);
    }
  };

  it('does not challenge or contact the provider on normal sign-in', async () => {
    login.mockResolvedValue(success);
    await post(1).expect(200);
    expect(provider).not.toHaveBeenCalled();
  });
  it('rejects suspicious clients before authentication, accepts a proof, then recovers after successful sign-in', async () => {
    await failThree();
    const blocked = await post(1).expect(403);
    expect(blocked.body.code).toBe('BOT_CHALLENGE_REQUIRED');
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(login).toHaveBeenCalledTimes(3);
    expect(provider).not.toHaveBeenCalled();
    login.mockResolvedValue(success);
    await post(1, 'owner@example.test', 'valid-proof').expect(200);
    now += 11_000;
    await post(1).expect(200);
    expect(provider).toHaveBeenCalledOnce();
  });
  it('uses normalized account failures across trusted IPs', async () => {
    for (let i = 1; i <= 5; i++) {
      now += 2000;
      await post(i, ' OWNER@example.test ').expect(401);
    }
    await post(10).expect(403);
    expect(login).toHaveBeenCalledTimes(5);
    await post(11, 'different@example.test').expect(401);
  });
  it('does not let untrusted forwarding headers reset challenge risk', async () => {
    configureTrustedProxy(app, '');
    try {
      for (let i = 1; i <= 3; i++) {
        now += 2000;
        await post(i, `${i}@example.test`).expect(401);
      }
      await post(99, 'new@example.test').expect(403);
      expect(login).toHaveBeenCalledTimes(3);
    } finally {
      configureTrustedProxy(app, '127.0.0.1/32,::1/128');
    }
  });
  it('rejects invalid and replayed proofs without another authentication call', async () => {
    await failThree();
    provider.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false }),
    });
    await post(1, 'owner@example.test', 'bad-proof').expect(403);
    now += 11_000;
    await post(1, 'owner@example.test', 'fresh-proof').expect(401);
    await post(1, 'owner@example.test', 'fresh-proof').expect(403);
    expect(login).toHaveBeenCalledTimes(4);
    expect(provider).toHaveBeenCalledTimes(2);
  });
  it('does not bypass hard rate limits even with a proof', async () => {
    await failThree();
    await post(1).expect(403);
    await post(1).expect(403);
    await post(1, 'owner@example.test', 'proof').expect(429);
    expect(provider).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalledTimes(3);
  });
  it('keeps credential capacity available while two provider verifications are pending', async () => {
    for (let i = 1; i <= 5; i++) {
      now += 2000;
      await post(i).expect(401);
    }
    const finish: (() => void)[] = [];
    provider.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish.push(() =>
            resolve({
              ok: true,
              json: async () => ({
                success: true,
                action: 'login',
                hostname: 'app.example.test',
                challenge_ts: new Date(Date.now()).toISOString(),
              }),
            }),
          );
        }),
    );
    const first = post(10, 'owner@example.test', 'pending-one').then(
      (reply) => reply,
    );
    const second = post(11, 'owner@example.test', 'pending-two').then(
      (reply) => reply,
    );
    try {
      await vi.waitFor(() => expect(finish).toHaveLength(2));
      await post(12, 'owner@example.test', 'overflow').expect(503);
      expect(login).toHaveBeenCalledTimes(5);
      login.mockResolvedValue(success);
      await post(20, 'clean@example.test').expect(200);
      expect(login).toHaveBeenCalledTimes(6);
    } finally {
      finish.forEach((resolve) => resolve());
      await Promise.all([first, second]);
    }
  });
  it('fails closed during provider outage while a fresh client can still sign in normally', async () => {
    await failThree();
    provider.mockRejectedValue(new Error('private network failure'));
    const busy = await post(1, 'owner@example.test', 'proof').expect(503);
    expect(busy.body.code).toBe('BOT_CHALLENGE_UNAVAILABLE');
    expect(busy.headers['retry-after']).toBe('5');
    expect(busy.text).not.toContain('private');
    expect(login).toHaveBeenCalledTimes(3);
    login.mockResolvedValue(success);
    await post(2, 'normal@example.test').expect(200);
  });
  it('escalates registration without depending on email existence', async () => {
    for (let i = 0; i < 2; i++) {
      now += 2000;
      await post(1, `${i}@example.test`, undefined, 'register').expect(201);
    }
    now += 11_000;
    await post(1, 'another@example.test', undefined, 'register').expect(403);
    expect(register).toHaveBeenCalledTimes(2);
    provider.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        action: 'register',
        hostname: 'app.example.test',
        challenge_ts: new Date(Date.now()).toISOString(),
      }),
    });
    await post(1, 'another@example.test', 'register-proof', 'register').expect(
      201,
    );
  });
});
