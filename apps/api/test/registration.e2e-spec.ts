import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthRepository } from '../src/modules/auth/auth.repository.js';
import { PrismaService } from '../src/database/prisma.service.js';

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
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  beforeEach(() => {
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
    expect(response.body).toEqual({
      user: {
        id: 'user-id',
        email: input.email,
        createdAt: '2026-10-08T00:00:00.000Z',
      },
    });
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

  it('returns a consistent 409 for duplicate email', async () => {
    repository.findAccountByEmail.mockResolvedValue({ id: 'existing' });
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(input)
      .expect(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      code: 'EMAIL_ALREADY_EXISTS',
      fieldErrors: { email: expect.any(Array) },
    });
    expect(repository.createAccount).not.toHaveBeenCalled();
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
