import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { IdentityService } from '../src/modules/auth/identity.service.js';
import { resetRateLimits } from './rate-limit-test-utils.js';
const google = vi.fn();
const sendCode = vi.fn();
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(AuthService)
    .useValue({ google })
    .overrideProvider(IdentityService)
    .useValue({ sendCode })
    .compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
});
beforeEach(() => {
  resetRateLimits(app);
  vi.resetAllMocks();
});
afterAll(async () => app.close());
it('binds the Google challenge to an HttpOnly cookie while returning only its hash', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/google/challenge')
    .set('X-PaServe-Client', 'web')
    .send({})
    .expect(200);
  const cookie = response.headers['set-cookie'][0] as string;
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('Path=/api/v1/auth');
  const nonce = cookie.match(/paserve_google_nonce=([a-f0-9]+)/u)![1];
  expect(response.body.nonce).toBe(
    createHash('sha256').update(nonce).digest('hex'),
  );
  expect(response.headers['cache-control']).toBe('no-store');
});
it('requires the trusted browser header for email and Google requests', async () => {
  for (const route of [
    'email-code',
    'google/challenge',
    'google/login',
    'google/register',
  ])
    await request(app.getHttpServer())
      .post(`/api/v1/auth/${route}`)
      .send({})
      .expect(403);
  expect(sendCode).not.toHaveBeenCalled();
  expect(google).not.toHaveBeenCalled();
});
it('normalizes email code requests and rejects unrelated fields', async () => {
  sendCode.mockResolvedValue({ message: 'Check your inbox.' });
  await request(app.getHttpServer())
    .post('/api/v1/auth/email-code')
    .set('X-PaServe-Client', 'web')
    .send({ email: ' Owner@Example.com ' })
    .expect(200);
  expect(sendCode).toHaveBeenCalledWith('owner@example.com');
  await request(app.getHttpServer())
    .post('/api/v1/auth/email-code')
    .set('X-PaServe-Client', 'web')
    .send({ email: 'owner@example.com', role: 'OWNER' })
    .expect(400);
});
it('requires first and last names for Google registration and rejects roles', async () => {
  await request(app.getHttpServer())
    .post('/api/v1/auth/google/register')
    .set('X-PaServe-Client', 'web')
    .send({ credential: 'token' })
    .expect(400);
  await request(app.getHttpServer())
    .post('/api/v1/auth/google/register')
    .set('X-PaServe-Client', 'web')
    .send({
      credential: 'token',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'OWNER',
    })
    .expect(400);
  expect(google).not.toHaveBeenCalled();
});
it('exchanges Google credentials for the existing protected session cookie', async () => {
  google.mockResolvedValue({
    response: { accessToken: 'access' },
    refreshToken: 'refresh',
    expiresAt: new Date(Date.now() + 60000),
    keepSignedIn: false,
  });
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/google/login')
    .set('X-PaServe-Client', 'web')
    .set('Cookie', `paserve_google_nonce=${'a'.repeat(64)}`)
    .send({ credential: 'google-token', keepSignedIn: false })
    .expect(200);
  expect(google).toHaveBeenCalledWith(
    expect.objectContaining({ credential: 'google-token' }),
    'a'.repeat(64),
  );
  expect(response.body).toEqual({ accessToken: 'access' });
  expect(response.headers['set-cookie'].join(';')).toContain('HttpOnly');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.text).not.toContain('refresh');
});
