import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { REGISTRATION_POLICY_VERSION } from '@paserve/contracts';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { IdentityService } from '../src/modules/auth/identity.service.js';
import { resetRateLimits } from './rate-limit-test-utils.js';

const policy = {
  policyVersion: REGISTRATION_POLICY_VERSION,
  adultConfirmed: true,
  termsAccepted: true,
  privacyAcknowledged: true,
};
const auth = { register: vi.fn(), google: vi.fn() };
const identity = { sendCode: vi.fn() };
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(AuthService)
    .useValue(auth)
    .overrideProvider(IdentityService)
    .useValue(identity)
    .compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
});
beforeEach(() => {
  resetRateLimits(app);
  vi.resetAllMocks();
});
afterAll(async () => {
  await app.close();
});

describe.each([
  ['email-code', { email: 'owner@example.com' }],
  [
    'register',
    {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'owner@example.com',
      password: 'a long test passphrase',
      verificationCode: '123456',
    },
  ],
  [
    'google/register',
    { firstName: 'Ada', lastName: 'Lovelace', credential: 'test-credential' },
  ],
])('%s declaration enforcement', (route, body) => {
  it.each([
    {},
    { ...policy, adultConfirmed: false },
    { ...policy, termsAccepted: false },
    { ...policy, privacyAcknowledged: false },
    { ...policy, adultConfirmed: 'true' },
    { ...policy, termsAccepted: 1 },
    { ...policy, privacyAcknowledged: undefined },
    { ...policy, policyVersion: '2026-01-01' },
  ])(
    'rejects missing, refused, coerced or stale declarations (%j)',
    async (declarations) => {
      await request(app.getHttpServer())
        .post(`/api/v1/auth/${route}`)
        .set('X-PaServe-Client', 'web')
        .send({ ...body, ...declarations })
        .expect(400);
      expect(auth.register).not.toHaveBeenCalled();
      expect(auth.google).not.toHaveBeenCalled();
      expect(identity.sendCode).not.toHaveBeenCalled();
    },
  );
});

it('passes the current accepted policy through Google registration', async () => {
  auth.google.mockResolvedValue({
    response: { accessToken: 'test-access' },
    refreshToken: 'test-refresh',
    expiresAt: new Date(Date.now() + 60_000),
    keepSignedIn: false,
  });
  await request(app.getHttpServer())
    .post('/api/v1/auth/google/register')
    .set('X-PaServe-Client', 'web')
    .set('Cookie', `paserve_google_nonce=${'a'.repeat(64)}`)
    .send({
      firstName: 'Ada',
      lastName: 'Lovelace',
      credential: 'test-credential',
      ...policy,
    })
    .expect(200);
  expect(auth.google).toHaveBeenCalledWith(
    expect.objectContaining(policy),
    'a'.repeat(64),
  );
});
