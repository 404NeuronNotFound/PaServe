import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import type { Response } from 'express';
import { AuthAbuseProtection } from './auth-abuse-protection.js';

describe('authentication resource admission', () => {
  let now: number;
  let protection: AuthAbuseProtection;
  const setHeader = vi.fn();
  const response = { setHeader } as unknown as Response;
  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    protection = new AuthAbuseProtection(new ConfigService());
    setHeader.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('admits immediately, bounds active work, and releases exactly once', () => {
    const first = protection.acquire(response);
    const second = protection.acquire(response);
    expect(() => protection.acquire(response)).toThrow(HttpException);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', 1);
    first();
    first();
    const third = protection.acquire(response);
    expect(() => protection.acquire(response)).toThrow(HttpException);
    second();
    third();
  });

  it('bounds serial credential stuffing across changing identities and refills without a queue', () => {
    for (let i = 0; i < 10; i++)
      protection.acquire(response, `${i}@test.com`)();
    expect(() => protection.acquire(response, 'fresh@test.com')).toThrow(
      HttpException,
    );
    now = 1000;
    protection.acquire(response, 'fresh@test.com')();
    expect(() => protection.acquire(response)).toThrow(HttpException);
  });

  it('normalizes account budgets, rejects without extending expiry, and recovers', () => {
    for (let i = 0; i < 20; i++) {
      now = i * 1100;
      protection.acquire(
        response,
        i % 2 ? ' OWNER@Test.com ' : 'owner@test.com',
      )();
    }
    now = 30_000;
    expect(() => protection.acquire(response, 'owner@test.com')).toThrow(
      HttpException,
    );
    expect(setHeader).toHaveBeenCalledWith('Retry-After', 30);
    protection.acquire(response, 'other@test.com')();
    now = 60_000;
    protection.acquire(response, 'owner@test.com')();
  });

  it.each([0, -1, 1.5, 'wrong', 33])(
    'fails startup for invalid concurrency %s',
    (value) => {
      expect(
        () =>
          new AuthAbuseProtection(
            new ConfigService({ AUTH_MAX_CONCURRENT: value }),
          ),
      ).toThrow();
    },
  );

  it('does not spend a victim source budget when other sources target the same normalized account', () => {
    for (let i = 0; i < 24; i++) {
      now = i * 1100;
      protection.acquire(
        response,
        i % 2 ? ' OWNER@Test.com ' : 'owner@test.com',
        `192.0.2.${i + 1}`,
      )();
    }
    expect(() =>
      protection.acquire(response, 'owner@test.com', '192.0.2.99')(),
    ).not.toThrow();
  });

  it('keeps account/source metadata bounded without rejecting a new victim when it fills', () => {
    const accounts = Reflect.get(protection, 'accounts') as Map<
      string,
      { hits: number; expires: number }
    >;
    for (let i = 0; i < 10_000; i++)
      accounts.set(`synthetic-${i}`, { hits: 20, expires: 60000 });
    expect(() =>
      protection.acquire(response, 'victim@test.com', '192.0.2.99')(),
    ).not.toThrow();
    expect(accounts.size).toBe(10_000);
  });

  it('does not store raw account identifiers or passwords', () => {
    protection.acquire(response, 'private@example.com')();
    const state = JSON.stringify([...Reflect.get(protection, 'accounts')]);
    expect(state).not.toContain('private');
    expect(state).toMatch(/[a-f0-9]{64}/u);
  });
});
