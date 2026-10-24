import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokensService } from './tokens.service.js';

describe('Server-enforced token expiration', () => {
  const jwt = new JwtService();
  const tokens = new TokensService(
    jwt,
    new ConfigService({
      JWT_ACCESS_SECRET: 'test-access-secret-with-at-least-32-characters',
      JWT_REFRESH_SECRET: 'test-refresh-secret-with-at-least-32-characters',
    }),
  );
  const start = new Date('2026-10-24T08:00:00.000Z');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(start);
  });
  afterEach(() => vi.useRealTimers());

  it('caps access JWT expiry at the absolute session deadline and rejects both tokens at that deadline', async () => {
    const expiry = new Date(start.getTime() + 30_000);
    const pair = await tokens.issue('user', 'session', expiry, false);
    expect(pair.expiresIn).toBe(30);
    expect(jwt.decode(pair.accessToken).exp).toBe(
      Math.floor(expiry.getTime() / 1000),
    );
    expect(jwt.decode(pair.refreshToken).exp).toBe(
      jwt.decode(pair.accessToken).exp,
    );
    vi.setSystemTime(expiry.getTime() - 1);
    await expect(
      tokens.verify(pair.accessToken, 'access'),
    ).resolves.toMatchObject({ sub: 'user' });
    vi.setSystemTime(expiry);
    await expect(
      tokens.verify(pair.accessToken, 'access'),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      tokens.verify(pair.refreshToken, 'refresh'),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('expires access after 15 minutes while allowing refresh only until its server deadline', async () => {
    const expiry = new Date(start.getTime() + 8 * 60 * 60 * 1000);
    const pair = await tokens.issue('user', 'session', expiry, false);
    expect(pair.expiresIn).toBe(900);
    vi.setSystemTime(start.getTime() + 900_000);
    await expect(
      tokens.verify(pair.accessToken, 'access'),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      tokens.verify(pair.refreshToken, 'refresh'),
    ).resolves.toMatchObject({ sid: 'session' });
    vi.setSystemTime(expiry);
    await expect(
      tokens.verify(pair.refreshToken, 'refresh'),
    ).rejects.toMatchObject({ status: 401 });
  });

  it.each([-1, 0, 500])(
    'does not issue tokens for an elapsed or sub-second deadline (%s ms)',
    async (remaining) => {
      await expect(
        tokens.issue('user', 'session', new Date(start.getTime() + remaining)),
      ).rejects.toMatchObject({ status: 401 });
    },
  );
});
