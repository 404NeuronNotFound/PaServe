import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, verify, argon2id } from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthRepository } from '../src/modules/auth/auth.repository.js';
import { IdentityService } from '../src/modules/auth/identity.service.js';
import { TokensService } from '../src/modules/auth/tokens.service.js';
import { resetRateLimits } from './rate-limit-test-utils.js';

describe('Self-service account updates', () => {
  let app: INestApplication<App>;
  const password = 'current long passphrase';
  let access: string;
  let otherAccess: string;
  let refresh: string;
  let revoked = false;
  let pending: Record<string, any> | null = null;
  const identity = { sendCode: vi.fn(), verifyEmail: vi.fn() };
  const prisma = {
    $transaction: vi.fn(),
    user: { updateMany: vi.fn() },
    authSession: { updateMany: vi.fn() },
    pendingEmailChange: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  const account = {
    id: 'self',
    email: 'lia@example.com',
    passwordHash: '',
    firstName: 'Lia',
    lastName: 'Navarro',
    createdAt: new Date(),
    memberships: [],
  };
  const repository = {
    findSession: vi.fn(),
    findCredentialAccount: vi.fn(),
    findAccountByEmail: vi.fn(),
    updateProfile: vi.fn(),
    changeCredentials: vi.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthRepository)
      .useValue(repository)
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(IdentityService)
      .useValue(identity)
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          JWT_ACCESS_SECRET: 'test-access-secret-with-at-least-32-characters',
          JWT_REFRESH_SECRET: 'test-refresh-secret-with-at-least-32-characters',
          FRONTEND_ORIGINS: 'http://localhost:5173',
          NODE_ENV: 'test',
        }),
      )
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    resetRateLimits(app);
    vi.resetAllMocks();
    revoked = false;
    pending = null;
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    prisma.user.updateMany.mockImplementation(({ data }) => {
      Object.assign(account, data);
      return { count: 1 };
    });
    prisma.authSession.updateMany.mockImplementation(() => {
      revoked = true;
      return { count: 1 };
    });
    prisma.pendingEmailChange.create.mockImplementation(({ data }) => {
      pending = {
        ...data,
        attempts: 0,
        currentConfirmed: false,
        newConfirmed: false,
      };
      return pending;
    });
    prisma.pendingEmailChange.findUnique.mockImplementation(() => pending);
    prisma.pendingEmailChange.updateMany.mockImplementation(
      ({ where, data }) => {
        if (!pending || pending.id !== where.id) return { count: 0 };
        Object.assign(pending, {
          ...data,
          ...(data.attempts ? { attempts: pending.attempts + 1 } : {}),
        });
        return { count: 1 };
      },
    );
    prisma.pendingEmailChange.deleteMany.mockImplementation(({ where }) => {
      if (!pending || !where.id || pending.id !== where.id) return { count: 0 };
      pending = null;
      return { count: 1 };
    });
    account.email = 'lia@example.com';
    account.firstName = 'Lia';
    account.lastName = 'Navarro';
    account.passwordHash = await hash(password, { type: argon2id });
    const tokens = app.get(TokensService);
    const pair = await tokens.issue(
      account.id,
      'session',
      new Date(Date.now() + 60_000),
    );
    access = pair.accessToken;
    refresh = pair.refreshToken;
    otherAccess = (
      await tokens.issue(
        account.id,
        'other-session',
        new Date(Date.now() + 60_000),
      )
    ).accessToken;
    repository.findSession.mockImplementation(() =>
      revoked ? null : { user: account },
    );
    repository.findCredentialAccount.mockImplementation(() =>
      revoked ? null : account,
    );
    repository.findAccountByEmail.mockResolvedValue(null);
    repository.updateProfile.mockImplementation((_id, _session, data) => {
      Object.assign(account, data);
      return data;
    });
    repository.changeCredentials.mockImplementation(
      (_id, _session, _hash, data) => {
        Object.assign(account, data);
        revoked = true;
      },
    );
  });
  const write = (path: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/auth/${path}`)
      .set('X-PaServe-Client', 'web')
      .set('Authorization', `Bearer ${access}`);
  const patch = () =>
    request(app.getHttpServer())
      .patch('/api/v1/auth/profile')
      .set('X-PaServe-Client', 'web')
      .set('Authorization', `Bearer ${access}`);

  it('normalizes names and scopes the update to the verified identity and session', async () => {
    const response = await patch()
      .send({ firstName: ' Maria ', lastName: ' Navarro ' })
      .expect(200);
    expect(response.body).toEqual({ firstName: 'Maria', lastName: 'Navarro' });
    expect(repository.updateProfile).toHaveBeenCalledWith('self', 'session', {
      firstName: 'Maria',
      lastName: 'Navarro',
    });
    expect(response.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
  });

  it('rejects anonymous writes, untrusted origins, and extra identity or privilege fields', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/auth/profile')
      .set('X-PaServe-Client', 'web')
      .send({ firstName: 'Other', lastName: '' })
      .expect(401);
    await patch()
      .set('Origin', 'https://untrusted.example')
      .send({ firstName: 'Other', lastName: '' })
      .expect(403);
    await patch()
      .send({
        firstName: 'Other',
        lastName: '',
        userId: 'victim',
        isActive: true,
      })
      .expect(400);
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it('rejects malformed fields without exposing secrets', async () => {
    await patch()
      .send({ firstName: 'x'.repeat(81), lastName: '' })
      .expect(400);
    const response = await write('password')
      .send({ currentPassword: password, password: 'short' })
      .expect(400);
    expect(JSON.stringify(response.body)).not.toContain(password);
    await write('email')
      .send({ currentPassword: password, email: 'invalid' })
      .expect(400);
    expect(repository.changeCredentials).not.toHaveBeenCalled();
  });

  it('rejects an incorrect current password without revoking sessions', async () => {
    const response = await write('password')
      .send({
        currentPassword: 'incorrect password',
        password: 'replacement long passphrase',
      })
      .expect(400);
    expect(response.body.code).toBe('CURRENT_PASSWORD_INCORRECT');
    expect(repository.changeCredentials).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
  });

  it('stores an Argon2 password and invalidates both access sessions and refresh tokens', async () => {
    const originalHash = account.passwordHash;
    const response = await write('password')
      .send({
        currentPassword: password,
        password: 'replacement long passphrase',
      })
      .expect(204);
    expect(repository.changeCredentials).toHaveBeenCalledWith(
      'self',
      'session',
      originalHash,
      { passwordHash: expect.any(String) },
    );
    expect(
      await verify(account.passwordHash, 'replacement long passphrase'),
    ).toBe(true);
    expect(await verify(account.passwordHash, password)).toBe(false);
    expect(response.headers['set-cookie'][0]).toContain('paserve_refresh=;');
    for (const token of [access, otherAccess])
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('X-PaServe-Client', 'web')
      .set('Cookie', `paserve_refresh=${refresh}`)
      .send({})
      .expect(401);
  });

  it('keeps the current email until both inboxes confirm and only then revokes sessions', async () => {
    const oldHash = account.passwordHash;
    const start = await write('email')
      .send({ currentPassword: password, email: ' New@Example.com ' })
      .expect(200);
    const id = start.body.pending.id;
    expect(account.email).toBe('lia@example.com');
    expect(revoked).toBe(false);
    expect(start.headers['set-cookie'].join()).not.toContain(
      'paserve_refresh=;',
    );
    expect(identity.sendCode).toHaveBeenCalledExactlyOnceWith(
      'lia@example.com',
    );
    await write('email/confirm')
      .send({ id, target: 'new', code: '123456' })
      .expect(400);
    const first = await write('email/confirm')
      .send({ id, target: 'current', code: '123456' })
      .expect(200);
    expect(first.body.completed).toBe(false);
    expect(account.email).toBe('lia@example.com');
    const finish = await write('email/confirm')
      .send({ id, target: 'new', code: '654321' })
      .expect(200);
    expect(finish.body.completed).toBe(true);
    expect(account.email).toBe('new@example.com');
    expect(account.passwordHash).toBe(oldHash);
    expect(revoked).toBe(true);
    expect(finish.headers['set-cookie'][0]).toContain('paserve_refresh=;');
    expect(identity.verifyEmail).toHaveBeenNthCalledWith(
      1,
      'lia@example.com',
      '123456',
    );
    expect(identity.verifyEmail).toHaveBeenNthCalledWith(
      2,
      'new@example.com',
      '654321',
    );
    for (const token of [access, otherAccess])
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer ' + token)
        .expect(401);
  });
  it('rejects anonymous, foreign ID, and injected identity fields on verification routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/email').expect(401);
    await write('email/confirm')
      .send({
        id: 'not-a-uuid',
        target: 'new',
        code: '123456',
        userId: 'other',
      })
      .expect(400);
    const start = await write('email')
      .send({ currentPassword: password, email: 'new@example.com' })
      .expect(200);
    const status = await request(app.getHttpServer())
      .get('/api/v1/auth/email')
      .set('Authorization', 'Bearer ' + access)
      .expect(200);
    expect(status.body.pending.id).toBe(start.body.pending.id);
    expect(status.headers['cache-control']).toBe('no-store');
    await write('email/confirm')
      .send({
        id: '00000000-0000-4000-8000-000000000000',
        target: 'current',
        code: '123456',
      })
      .expect(400);
    await write('email/cancel').send({ id: start.body.pending.id }).expect(200);
    expect(pending).toBeNull();
    expect(revoked).toBe(false);
  });

  it('rejects duplicate email without altering credentials', async () => {
    repository.findAccountByEmail.mockResolvedValue({ id: 'another-user' });
    const response = await write('email')
      .send({ currentPassword: password, email: 'taken@example.com' })
      .expect(409);
    expect(response.body.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(repository.changeCredentials).not.toHaveBeenCalled();
  });

  it('rate limits repeated credential guesses', async () => {
    for (let i = 0; i < 10; i++)
      await write('password')
        .send({
          currentPassword: 'incorrect password',
          password: 'replacement long passphrase',
        })
        .expect(400);
    await write('password')
      .send({
        currentPassword: 'incorrect password',
        password: 'replacement long passphrase',
      })
      .expect(429);
  });
});
