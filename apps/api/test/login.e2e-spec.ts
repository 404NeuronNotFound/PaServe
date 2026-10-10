import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { hash, argon2id } from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthRepository } from '../src/modules/auth/auth.repository.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { TokensService } from '../src/modules/auth/tokens.service.js';

describe('Login and session HTTP flow', () => {
  let app: INestApplication<App>;
  const password = 'a valid long passphrase';
  const account = {
    id: 'user-id',
    email: 'owner@example.com',
    isActive: true,
    passwordHash: '',
    createdAt: new Date('2026-10-08T00:00:00Z'),
    firstName: null as string | null,
    lastName: null as string | null,
    memberships: [] as {
      id: string;
      shopId: string;
      role: 'OWNER' | 'CASHIER';
      userId: string;
      shop: {
        id: string;
        name: string;
        slug: string;
        isActive: boolean;
        logoUrl?: string | null;
        privateData: string;
      };
    }[],
  };
  const safeUser = {
    id: account.id,
    email: account.email,
    createdAt: account.createdAt.toISOString(),
  };
  const safeCurrentUser = {
    ...safeUser,
    firstName: null,
    lastName: null,
    memberships: [],
  };
  const sessions = new Map<
    string,
    {
      id: string;
      userId: string;
      refreshTokenHash: string;
      expiresAt: Date;
      revokedAt: Date | null;
    }
  >();
  const repository = {
    findLoginAccount: vi.fn(),
    createSession: vi.fn(),
    findSession: vi.fn(),
    rotateSession: vi.fn(),
    revokeSession: vi.fn(),
  };

  beforeAll(async () => {
    account.passwordHash = await hash(password, { type: argon2id });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthRepository)
      .useValue(repository)
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          JWT_ACCESS_SECRET: 'test-access-secret-with-at-least-32-characters',
          JWT_REFRESH_SECRET: 'test-refresh-secret-with-at-least-32-characters',
          FRONTEND_ORIGINS: 'http://localhost:5173',
          NODE_ENV: 'test',
        }),
      )
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    sessions.clear();
    account.isActive = true;
    account.firstName = null;
    account.lastName = null;
    account.memberships = [];
    repository.findLoginAccount.mockResolvedValue(account);
    repository.createSession.mockImplementation(
      (
        id: string,
        userId: string,
        refreshTokenHash: string,
        expiresAt: Date,
      ) => {
        const session = {
          id,
          userId,
          refreshTokenHash,
          expiresAt,
          revokedAt: null,
        };
        sessions.set(id, session);
        return Promise.resolve(session);
      },
    );
    repository.findSession.mockImplementation((id: string, userId: string) => {
      const session = sessions.get(id);
      return Promise.resolve(
        session &&
          session.userId === userId &&
          !session.revokedAt &&
          session.expiresAt > new Date() &&
          account.isActive
          ? { ...session, user: account }
          : null,
      );
    });
    repository.rotateSession.mockImplementation(
      (
        id: string,
        _userId: string,
        previousHash: string,
        refreshTokenHash: string,
      ) => {
        const session = sessions.get(id);
        if (
          !session ||
          session.refreshTokenHash !== previousHash ||
          session.revokedAt
        )
          return Promise.resolve({ count: 0 });
        session.refreshTokenHash = refreshTokenHash;
        return Promise.resolve({ count: 1 });
      },
    );
    repository.revokeSession.mockImplementation((id: string) => {
      const session = sessions.get(id);
      if (session) session.revokedAt = new Date();
      return Promise.resolve({ count: session ? 1 : 0 });
    });
  });

  const login = () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-PaServe-Client', 'web')
      .send({ email: ' Owner@Example.com ', password });
  function cookie(response: { headers: Record<string, unknown> }): string {
    return (response.headers['set-cookie'] as string[])[0].split(';')[0];
  }
  const cookiePost = (path: string, value: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/auth/${path}`)
      .set('X-PaServe-Client', 'web')
      .set('Cookie', value)
      .send({});

  it('normalizes email, verifies Argon2, returns safe user and access JWT, stores only refresh digest', async () => {
    const response = await login().expect(200);
    expect(repository.findLoginAccount).toHaveBeenCalledWith(account.email);
    expect(response.body).toEqual({
      user: safeUser,
      accessToken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    const setCookie = (
      response.headers['set-cookie'] as unknown as string[]
    )[0];
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/api/v1/auth');
    const refresh = decodeURIComponent(cookie(response).split('=')[1]);
    const claims = await app
      .get(TokensService)
      .verify(response.body.accessToken as string, 'access');
    expect(claims.sub).toBe(account.id);
    expect(sessions.get(claims.sid)?.refreshTokenHash).toBe(
      app.get(TokensService).digest(refresh),
    );
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(password);
    expect(JSON.stringify(response.body)).not.toContain(refresh);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200, { user: safeCurrentUser });
  });

  it('returns the current safe profile and shop memberships without private fields', async () => {
    const response = await login().expect(200);
    account.firstName = 'Alex';
    account.lastName = 'Owner';
    account.memberships = [
      {
        id: 'membership-id',
        shopId: 'shop-id',
        role: 'OWNER',
        userId: account.id,
        shop: {
          id: 'shop-id',
          name: 'Corner Cafe',
          slug: 'corner-cafe',
          isActive: true,
          privateData: 'must stay private',
          logoUrl: 'https://example.com/corner-cafe/logo.webp',
        },
      },
    ];
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200, {
        user: {
          ...safeUser,
          firstName: 'Alex',
          lastName: 'Owner',
          memberships: [
            {
              id: 'membership-id',
              shopId: 'shop-id',
              role: 'OWNER',
              shop: {
                id: 'shop-id',
                name: 'Corner Cafe',
                slug: 'corner-cafe',
                isActive: true,
                logoUrl: 'https://example.com/corner-cafe/logo.webp',
              },
            },
          ],
        },
      });
    // Membership changes are read from the database, not stale JWT claims.
    account.memberships = [];
    const current = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200);
    expect(current.body.user.memberships).toEqual([]);
    expect(current.headers['cache-control']).toBe('no-store');
  });

  it.each(['missing', 'wrong', 'inactive'])(
    'rejects %s account without issuing sessions',
    async (kind) => {
      if (kind === 'missing')
        repository.findLoginAccount.mockResolvedValue(null);
      if (kind === 'inactive') account.isActive = false;
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-PaServe-Client', 'web')
        .send({
          email: account.email,
          password: kind === 'wrong' ? 'wrong passphrase' : password,
        })
        .expect(401);
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(repository.createSession).not.toHaveBeenCalled();
    },
  );

  it.each([
    { email: 'invalid', password },
    { email: account.email },
    { email: account.email, password: {} },
    { email: account.email, password: '' },
    { email: account.email, password: 'x'.repeat(129) },
    { email: account.email, password, role: 'OWNER' },
  ])('rejects invalid login DTO (%j)', async (input) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-PaServe-Client', 'web')
      .send(input)
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(repository.findLoginAccount).not.toHaveBeenCalled();
  });

  it('rejects untrusted browser origins and missing custom headers', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-PaServe-Client', 'web')
      .set('Origin', 'https://attacker.example')
      .send({ email: account.email, password })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: account.email, password })
      .expect(403);
    expect(repository.findLoginAccount).not.toHaveBeenCalled();
  });

  it('rotates refresh JWT and revokes the entire session on reuse', async () => {
    const response = await login().expect(200);
    const oldCookie = cookie(response);
    const rotated = await cookiePost('refresh', oldCookie).expect(200);
    expect(cookie(rotated)).not.toBe(oldCookie);
    expect(rotated.body.user).toEqual(safeUser);
    const next = await cookiePost('refresh', cookie(rotated)).expect(200);
    await cookiePost('refresh', oldCookie).expect(401);
    await cookiePost('refresh', cookie(rotated)).expect(401);
    await cookiePost('refresh', cookie(next)).expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${next.body.accessToken}`)
      .expect(401);
  });

  it('refreshes an expired access token and accepts the new access token', async () => {
    const response = await login().expect(200);
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 901_000);
    try {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${response.body.accessToken}`)
        .expect(401);
      const refreshed = await cookiePost('refresh', cookie(response)).expect(
        200,
      );
      expect(refreshed.body.accessToken).not.toBe(response.body.accessToken);
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
        .expect(200, { user: safeCurrentUser });
    } finally {
      now.mockRestore();
    }
  });

  it('rejects forged, expired and wrong-purpose refresh tokens without rotating', async () => {
    const response = await login().expect(200);
    const claims = await app
      .get(TokensService)
      .verify(response.body.accessToken as string, 'access');
    const expired = await app.get(JwtService).signAsync(
      { sub: account.id, sid: claims.sid, type: 'refresh' },
      {
        secret: 'test-refresh-secret-with-at-least-32-characters',
        issuer: 'paserve-api',
        audience: 'paserve:refresh',
        expiresIn: -1,
      },
    );
    for (const token of ['forged-token', expired, response.body.accessToken]) {
      const rejected = await cookiePost(
        'refresh',
        `paserve_refresh=${encodeURIComponent(token as string)}`,
      ).expect(401);
      expect(rejected.body.code).toBe('INVALID_SESSION');
      expect(rejected.headers['set-cookie']).toBeUndefined();
    }
    expect(repository.rotateSession).not.toHaveBeenCalled();
    await cookiePost('refresh', cookie(response)).expect(200);
  });

  it('revokes access and refresh on logout and clears the cookie', async () => {
    const response = await login().expect(200);
    const loggedOut = await cookiePost('logout', cookie(response)).expect(204);
    expect(
      (loggedOut.headers['set-cookie'] as unknown as string[])[0],
    ).toContain('Expires=Thu, 01 Jan 1970');
    await cookiePost('refresh', cookie(response)).expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(401);
  });

  it('permits only one concurrent refresh for the same token', async () => {
    const response = await login().expect(200);
    const results = await Promise.all([
      cookiePost('refresh', cookie(response)),
      cookiePost('refresh', cookie(response)),
    ]);
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([200, 401]);
    const winner = results.find((result) => result.status === 200)!;
    await cookiePost('refresh', cookie(winner)).expect(401);
  });

  it('rejects access and refresh after account deactivation', async () => {
    const response = await login().expect(200);
    account.isActive = false;
    await cookiePost('refresh', cookie(response)).expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(401);
  });

  it('rejects missing, forged, expired and wrong-purpose access tokens', async () => {
    const response = await login().expect(200);
    const claims = await app
      .get(TokensService)
      .verify(response.body.accessToken as string, 'access');
    const expired = await app.get(JwtService).signAsync(
      { sub: account.id, sid: claims.sid, type: 'access' },
      {
        secret: 'test-access-secret-with-at-least-32-characters',
        issuer: 'paserve-api',
        audience: 'paserve:web',
        expiresIn: -1,
      },
    );
    const tokens = [
      'forged-token',
      expired,
      decodeURIComponent(cookie(response).split('=')[1]),
    ];
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    for (const token of tokens)
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
  });

  it('rejects refresh without cookie and body injection', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('X-PaServe-Client', 'web')
      .send({})
      .expect(401);
    const response = await login().expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('X-PaServe-Client', 'web')
      .set('Cookie', cookie(response))
      .send({ userId: 'other-user' })
      .expect(400);
  });

  it('returns a safe error and no tokens when session persistence fails', async () => {
    repository.createSession.mockRejectedValue(
      new Error('private database details'),
    );
    const response = await login().expect(500);
    expect(response.body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.text).not.toContain('private');
  });
});

it('limits repeated sign-in attempts before querying accounts', async () => {
  const findLoginAccount = vi.fn();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(AuthRepository)
    .useValue({ findLoginAccount })
    .compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-PaServe-Client', 'web')
        .send({})
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-PaServe-Client', 'web')
      .send({})
      .expect(429);
    expect(findLoginAccount).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
