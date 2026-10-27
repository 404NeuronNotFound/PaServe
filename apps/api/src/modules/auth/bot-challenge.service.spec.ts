import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { performance } from 'node:perf_hooks';
import { BotChallengeService } from './bot-challenge.service.js';

describe('progressive challenge policy and server verification', () => {
  let service: BotChallengeService;
  let now: number;
  const provider = vi.fn();
  const setHeader = vi.fn();
  const response = { setHeader } as unknown as Response;
  const config = {
    AUTH_BOT_CHALLENGE_ENABLED: 'true',
    TURNSTILE_SECRET_KEY: 'test-only-secret',
    TURNSTILE_HOSTNAMES: 'app.example.test',
    NODE_ENV: 'test',
  };
  const request = (ip = '192.0.2.1', email: unknown = 'owner@example.test') =>
    ({ ip, body: { email } }) as Request;
  const verdict = (fields: Record<string, unknown> = {}) => ({
    ok: true,
    json: async () => ({
      success: true,
      hostname: 'app.example.test',
      action: 'login',
      challenge_ts: new Date().toISOString(),
      ...fields,
    }),
  });
  const suspicious = () => {
    const risk = service.assess(request(), 'login');
    for (let i = 0; i < 3; i++)
      service.failed(risk, new UnauthorizedException());
    return risk;
  };
  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    provider.mockReset().mockImplementation(async () => verdict());
    vi.stubGlobal('fetch', provider);
    setHeader.mockClear();
    service = new BotChallengeService(new ConfigService(config));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('leaves normal login, registration and unrelated authenticated work challenge-free', async () => {
    await service.check(
      service.assess(request(), 'login'),
      undefined,
      response,
    );
    await service.check(
      service.assess(request(), 'register'),
      undefined,
      response,
    );
    await service.check(
      service.assess(request(), 'refresh'),
      'unsolicited-token',
      response,
    );
    expect(provider).not.toHaveBeenCalled();
  });
  it('requires proof after three IP failures even when the email changes', async () => {
    suspicious();
    await expect(
      service.check(
        service.assess(request('192.0.2.1', 'other@example.test'), 'login'),
        undefined,
        response,
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'BOT_CHALLENGE_REQUIRED' },
    });
    expect(provider).not.toHaveBeenCalled();
  });
  it('normalizes distributed account failures and IPv6 subnets', async () => {
    for (let i = 1; i <= 5; i++)
      service.failed(
        service.assess(
          request(`192.0.2.${i}`, ' OWNER@example.test '),
          'login',
        ),
        new UnauthorizedException(),
      );
    await expect(
      service.check(
        service.assess(request('192.0.2.99'), 'login'),
        undefined,
        response,
      ),
    ).rejects.toMatchObject({ status: 403 });
    for (let i = 1; i <= 3; i++)
      service.failed(
        service.assess(request(`2001:db8::${i}`, `${i}@example.test`), 'login'),
        new UnauthorizedException(),
      );
    await expect(
      service.check(
        service.assess(
          request('2001:db8::99', 'different@example.test'),
          'login',
        ),
        undefined,
        response,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('escalates repeated registration equally without looking up accounts', async () => {
    const risk = service.assess(request(), 'register');
    service.started(risk);
    await service.check(risk, undefined, response);
    service.started(risk);
    await expect(
      service.check(risk, undefined, response),
    ).rejects.toMatchObject({ status: 403 });
    provider.mockResolvedValue(verdict({ action: 'register' }));
    await service.check(risk, 'new-proof', response);
  });
  it('verifies only on the fixed server URL and checks hostname/action/expiry', async () => {
    await service.check(suspicious(), 'single-proof', response);
    expect(provider).toHaveBeenCalledOnce();
    const [url, options] = provider.mock.calls[0];
    expect(url).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    );
    expect(options.redirect).toBe('error');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options.body)).toEqual({
      secret: 'test-only-secret',
      response: 'single-proof',
    });
  });
  it.each([
    { success: false },
    { success: 'true' },
    { hostname: 'attacker.test' },
    { action: 'register' },
    { challenge_ts: 'invalid' },
    { challenge_ts: new Date(0).toISOString() },
    { challenge_ts: new Date(Date.now() + 60_000).toISOString() },
  ])('rejects invalid provider verdicts: %j', async (fields) => {
    provider.mockResolvedValue(verdict(fields));
    await expect(
      service.check(suspicious(), 'proof', response),
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each([null, '', ' ', 42, {}, 'x'.repeat(2049)])(
    'rejects malformed proof before making a provider call',
    async (token) => {
      await expect(
        service.check(suspicious(), token, response),
      ).rejects.toMatchObject({ status: 403 });
      expect(provider).not.toHaveBeenCalled();
    },
  );
  it('rejects replay locally, including concurrent reuse while verification is pending', async () => {
    let finish!: (value: ReturnType<typeof verdict>) => void;
    provider.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const risk = suspicious();
    const first = service.check(risk, 'replayed-proof', response);
    await expect(
      service.check(risk, 'replayed-proof', response),
    ).rejects.toMatchObject({ status: 403 });
    finish(verdict());
    await first;
    await expect(
      service.check(risk, 'replayed-proof', response),
    ).rejects.toMatchObject({ status: 403 });
    expect(provider).toHaveBeenCalledOnce();
  });
  it('keeps risk after solving a challenge; a successful login or expiry recovers normally', async () => {
    const risk = suspicious();
    await service.check(risk, 'proof', response);
    await expect(
      service.check(risk, undefined, response),
    ).rejects.toMatchObject({ status: 403 });
    service.succeeded(risk);
    await service.check(risk, undefined, response);
    suspicious();
    now = 900_001;
    await service.check(risk, undefined, response);
    expect(provider).toHaveBeenCalledOnce();
  });
  it.each(['timeout', 'http', 'json', 'internal'])(
    'fails closed on %s errors and releases verification capacity',
    async (kind) => {
      const risk = suspicious();
      if (kind === 'timeout')
        provider.mockRejectedValue(new Error('private failure'));
      if (kind === 'http') provider.mockResolvedValue({ ok: false });
      if (kind === 'json')
        provider.mockResolvedValue({
          ok: true,
          json: async () => {
            throw new Error('private response');
          },
        });
      if (kind === 'internal')
        provider.mockResolvedValue(
          verdict({ success: false, 'error-codes': ['internal-error'] }),
        );
      await expect(
        service.check(risk, 'proof', response),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: 'BOT_CHALLENGE_UNAVAILABLE' },
      });
      expect(setHeader).toHaveBeenCalledWith('Retry-After', 5);
      provider.mockResolvedValue(verdict());
      await service.check(risk, 'fresh-proof', response);
    },
  );
  it('bounds provider concurrency without waiting or affecting the normal path', async () => {
    const finishes: (() => void)[] = [];
    provider.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(() => resolve(verdict()));
        }),
    );
    const risk = suspicious();
    const first = service.check(risk, 'one', response);
    const second = service.check(risk, 'two', response);
    await expect(service.check(risk, 'three', response)).rejects.toMatchObject({
      status: 503,
    });
    await service.check(
      service.assess(request('192.0.2.99', 'new@example.test'), 'login'),
      undefined,
      response,
    );
    finishes.forEach((finish) => finish());
    await Promise.all([first, second]);
    expect(provider).toHaveBeenCalledTimes(2);
  });
  it('bounds serial provider floods and recovers after refill', async () => {
    const risk = suspicious();
    for (let i = 0; i < 10; i++)
      await service.check(risk, `proof-${i}`, response);
    await expect(
      service.check(risk, 'overflow', response),
    ).rejects.toMatchObject({ status: 503 });
    now = 1000;
    await service.check(risk, 'after-refill', response);
    expect(provider).toHaveBeenCalledTimes(11);
  });
  it('fails startup with incomplete enabled configuration and rejects production test keys', () => {
    expect(
      () =>
        new BotChallengeService(new ConfigService({ NODE_ENV: 'production' })),
    ).toThrow();
    expect(
      () =>
        new BotChallengeService(
          new ConfigService({
            ...config,
            TURNSTILE_HOSTNAMES: '*.example.test',
          }),
        ),
    ).toThrow();
    expect(
      () =>
        new BotChallengeService(
          new ConfigService({
            ...config,
            NODE_ENV: 'production',
            TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
          }),
        ),
    ).toThrow();
  });
});
