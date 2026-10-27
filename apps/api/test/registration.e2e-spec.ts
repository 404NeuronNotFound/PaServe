import { resetRateLimits } from './rate-limit-test-utils.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthRepository } from '../src/modules/auth/auth.repository.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ApiRateLimitGuard } from '../src/common/rate-limiting/api-rate-limit.guard.js';
import { REGISTRATION_ACKNOWLEDGEMENT } from '@paserve/contracts';

describe('POST /api/v1/auth/register', () => {
  let app: INestApplication<App>;
  const repository = { findAccountByEmail: vi.fn(), createAccount: vi.fn() };
  const input = {
    email: 'owner@example.com',
    password: 'a valid long passphrase',
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthRepository)
      .useValue(repository)
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(ApiRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  beforeEach(() => {
    resetRateLimits(app);
    vi.resetAllMocks();
    repository.findAccountByEmail.mockResolvedValue(null);
    repository.createAccount.mockResolvedValue({
      id: 'user-id',
      email: input.email,
      createdAt: new Date('2026-10-08T00:00:00Z'),
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('creates an account with 201 and an explicit safe response', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ ...input, email: ' Owner@Example.com ' })
      .expect(201);
    expect(response.body).toEqual({ message: REGISTRATION_ACKNOWLEDGEMENT });
    expect(repository.createAccount).toHaveBeenCalledWith(
      input.email,
      expect.stringMatching(/^\$argon2id\$/),
    );
  });

  it.each([
    { email: 'not-an-email', password: input.password },
    { email: input.email, password: 'short' },
    { email: input.email, password: 'x'.repeat(129) },
    { email: input.email, password: ' '.repeat(12) },
    { email: input.email },
    { password: input.password },
    { email: 42, password: input.password },
    { email: input.email, password: {} },
    { ...input, role: 'OWNER' },
    { ...input, shopId: 'other-shop' },
    { ...input, passwordHash: 'injected-hash' },
  ])('rejects invalid input without database writes (%j)', async (body) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(body)
      .expect(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(repository.findAccountByEmail).not.toHaveBeenCalled();
    expect(repository.createAccount).not.toHaveBeenCalled();
    expect(response.text).not.toContain(input.password);
  });

  it('returns the identical acknowledgement without revealing duplicate emails', async () => {
    repository.createAccount.mockResolvedValue({ count: 0 });
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(input)
      .expect(201);
    expect(response.body).toEqual({ message: REGISTRATION_ACKNOWLEDGEMENT });
    expect(repository.createAccount).toHaveBeenCalledWith(
      input.email,
      expect.stringMatching(/^\$argon2id\$/),
    );
    expect(repository.findAccountByEmail).not.toHaveBeenCalled();
  });

  it('keeps unexpected database details out of responses', async () => {
    repository.createAccount.mockRejectedValue(
      new Error('Sensitive database internals'),
    );
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(input)
      .expect(500);
    expect(response.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong. Please try again.',
    });
    expect(response.text).not.toContain('Sensitive');
  });

  it('does not echo credentials from malformed JSON', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"password":"a valid long passphrase", broken}')
      .expect(400);
    expect(response.text).not.toContain(input.password);
    expect(repository.createAccount).not.toHaveBeenCalled();
  });
});

it('throttles registration before querying accounts or hashing passwords', async () => {
  const repository = { findAccountByEmail: vi.fn(), createAccount: vi.fn() };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(AuthRepository)
    .useValue(repository)
    .compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({})
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'owner@example.com', password: 'a valid long passphrase' })
      .expect(429);
    expect(repository.findAccountByEmail).not.toHaveBeenCalled();
    expect(repository.createAccount).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
