import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { WalkthroughService } from '../src/modules/auth/walkthrough.service.js';
import { resetRateLimits } from './rate-limit-test-utils.js';
const progress = vi.fn();
const complete = vi.fn();
const self = {
  id: 'self',
  email: 'self@example.com',
  createdAt: '2026-11-01',
  memberships: [],
};
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(AuthService)
    .useValue({ currentUser: async () => self })
    .overrideProvider(WalkthroughService)
    .useValue({ progress, complete })
    .compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
});
beforeEach(() => {
  resetRateLimits(app);
  vi.clearAllMocks();
  progress.mockResolvedValue({ completedScopes: [] });
  complete.mockResolvedValue({ scope: 'account' });
});
afterAll(async () => app.close());
it('requires a live identity before reading or writing progress', async () => {
  await request(app.getHttpServer())
    .get('/api/v1/auth/walkthrough')
    .expect(401);
  await request(app.getHttpServer())
    .post('/api/v1/auth/walkthrough')
    .set('X-PaServe-Client', 'web')
    .send({ kind: 'account', outcome: 'skipped' })
    .expect(401);
  expect(progress).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});
it('lists only authenticated-account progress and disables response caching', async () => {
  const result = await request(app.getHttpServer())
    .get('/api/v1/auth/walkthrough')
    .set('Authorization', 'Bearer test')
    .expect(200);
  expect(progress).toHaveBeenCalledWith('self');
  expect(result.headers['cache-control']).toBe('no-store');
});
it('preserves origin checks and rejects injected account IDs/roles', async () => {
  await request(app.getHttpServer())
    .post('/api/v1/auth/walkthrough')
    .set('Authorization', 'Bearer test')
    .send({ kind: 'account', outcome: 'skipped' })
    .expect(403);
  for (const extra of [
    { userId: 'other' },
    { role: 'OWNER' },
    { version: 999 },
  ])
    await request(app.getHttpServer())
      .post('/api/v1/auth/walkthrough')
      .set('Authorization', 'Bearer test')
      .set('X-PaServe-Client', 'web')
      .send({ kind: 'account', outcome: 'skipped', ...extra })
      .expect(400);
  expect(complete).not.toHaveBeenCalled();
});
it('passes the server identity and validated completion to the service', async () => {
  await request(app.getHttpServer())
    .post('/api/v1/auth/walkthrough')
    .set('Authorization', 'Bearer test')
    .set('X-PaServe-Client', 'web')
    .send({ kind: 'account', outcome: 'completed' })
    .expect(200);
  expect(complete).toHaveBeenCalledWith(
    self,
    expect.objectContaining({ kind: 'account', outcome: 'completed' }),
  );
});
