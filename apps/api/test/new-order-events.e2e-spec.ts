import { resetRateLimits } from './rate-limit-test-utils.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { ShopRole } from '@paserve/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Response } from 'express';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { NewOrderEventsService } from '../src/modules/orders/new-order-events.service.js';
import { ShopMembersService } from '../src/modules/shop-members/shop-members.service.js';

describe('New order stream HTTP authorization', () => {
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  let app: INestApplication<App>;
  let streamSpy: unknown;
  let role: ShopRole;
  const auth = vi.fn();
  const membership = vi.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ shopMember: { findUnique: membership } })
      .overrideProvider(AuthService)
      .useValue({ currentUser: auth })
      .compile();
    const service = module.get(NewOrderEventsService);
    const members = module.get(ShopMembersService);
    // Exercise real authentication, role guards, DTO validation, and permission
    // checks while terminating the stream immediately for ordinary HTTP tests.
    streamSpy = vi
      .spyOn(service, 'stream')
      .mockImplementation(
        async (token, target, workflow, response: Response) => {
          const actor = await auth(token);
          await members.requirePermission(
            actor.id,
            target,
            workflow === 'cashier'
              ? 'shop.orders.read'
              : 'shop.preparation.queue.read',
          );
          response.status(200).end();
        },
      );
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    resetRateLimits(app);
    vi.clearAllMocks();
    role = 'OWNER';
    auth.mockResolvedValue({ id: userId });
    membership.mockImplementation(async ({ where }) =>
      where.userId_shopId.shopId === shopId
        ? {
            id: 'membership',
            shopId,
            role,
            user: { isActive: true },
            shop: { id: shopId, name: 'Cafe', slug: 'cafe', isActive: true },
          }
        : null,
    );
  });
  const get = (workflow = 'kitchen', target = shopId) =>
    request(app.getHttpServer())
      .get(`/api/v1/shops/${target}/orders/events?workflow=${workflow}`)
      .set('Authorization', 'Bearer staff-token');

  it.each(['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN'] as const)(
    'permits kitchen entry signals for %s',
    async (value) => {
      role = value;
      await get().expect(200);
      expect(streamSpy).toHaveBeenCalledWith(
        'staff-token',
        shopId,
        'kitchen',
        expect.anything(),
      );
    },
  );
  it.each(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] as const)(
    'permits cashier entry signals for %s',
    async (value) => {
      role = value;
      await get('cashier').expect(200);
    },
  );
  it('denies cashier/kitchen cross-workflow subscriptions', async () => {
    role = 'CASHIER';
    await get('kitchen').expect(403);
    role = 'KITCHEN';
    await get('cashier').expect(403);
  });
  it('denies anonymous requests and inaccessible shops', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/orders/events?workflow=kitchen`)
      .expect(401);
    await get('kitchen', '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24').expect(404);
    expect(streamSpy).not.toHaveBeenCalled();
  });
  it.each(['unknown', '', 'kitchen&shopId=other'])(
    'rejects invalid or extra query input (%s)',
    async (query) => {
      await get(query).expect(400);
      expect(streamSpy).not.toHaveBeenCalled();
    },
  );
});
