import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { ShopRole } from '@paserve/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { Prisma } from '../src/generated/prisma/client.js';

describe.each(['active', 'completed', 'cancelled'])(
  'Owner %s orders HTTP access',
  (view) => {
    const actorId = '75992537-5d60-4d22-8e1e-60a114644681';
    const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
    let app: INestApplication<App>;
    let role: ShopRole;
    let active: boolean;
    const findMany = vi.fn(),
      membership = vi.fn();
    beforeAll(async () => {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue({
          order: { findMany },
          shopMember: { findUnique: membership },
        })
        .overrideProvider(AuthService)
        .useValue({ currentUser: async () => ({ id: actorId }) })
        .compile();
      app = module.createNestApplication();
      app.setGlobalPrefix('api/v1');
      await app.init();
    });
    afterAll(async () => {
      await app.close();
    });
    beforeEach(() => {
      vi.clearAllMocks();
      role = 'OWNER';
      active = true;
      findMany.mockResolvedValue([]);
      membership.mockImplementation(
        async ({ where }: { where: { userId_shopId: { shopId: string } } }) =>
          where.userId_shopId.shopId === shopId && active
            ? {
                id: 'member',
                shopId,
                role,
                user: { isActive: true },
                shop: {
                  id: shopId,
                  name: 'Cafe',
                  slug: 'cafe',
                  isActive: true,
                },
              }
            : null,
      );
    });
    const get = (target = shopId, suffix = '') =>
      request(app.getHttpServer())
        .get(`/api/v1/shops/${target}/orders/${view}${suffix}`)
        .set('Authorization', 'Bearer test');

    it('returns an owner-only no-store projection of saved amounts and times', async () => {
      findMany.mockResolvedValue([
        {
          id: 'order',
          shopId,
          orderNumber: 'ORD-000042',
          mode: 'TAKEOUT',
          tableNumber: null,
          status: view === 'cancelled' ? 'REJECTED' : 'CONFIRMED',
          paymentStatus: view === 'cancelled' ? 'UNPAID' : 'PAID',
          preparationStatus:
            view === 'cancelled'
              ? null
              : view === 'completed'
                ? 'COMPLETED'
                : 'READY',
          decidedAt: new Date('2026-10-16T00:01:00Z'),
          decidedBy: actorId,
          rejectionReason: 'Item unavailable',
          paymentMethod: 'CASH',
          currency: 'PHP',
          totalPrice: new Prisma.Decimal('12.30'),
          createdAt: new Date('2026-10-16T00:00:00Z'),
          updatedAt: new Date('2026-10-16T00:05:00Z'),
          paidAt: new Date('2026-10-16T00:01:00Z'),
          completedAt: new Date('2026-10-16T00:05:00Z'),
        },
      ]);
      const response = await get().expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.orders[0]).toMatchObject({
        totalPrice: '12.30',
        preparationStatus:
          view === 'cancelled'
            ? null
            : view === 'completed'
              ? 'COMPLETED'
              : 'READY',
        createdAt: '2026-10-16T00:00:00.000Z',
      });
      expect(findMany.mock.calls[0][0].where.shopId).toBe(shopId);
      if (view === 'cancelled') {
        expect(response.body.orders[0]).toMatchObject({
          status: 'REJECTED',
          paymentStatus: 'UNPAID',
          decidedBy: actorId,
          rejectionReason: 'Item unavailable',
        });
      }
    });
    it.each<ShopRole>(['ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN'])(
      'denies %s without reading orders',
      async (value) => {
        role = value;
        await get().expect(403);
        expect(findMany).not.toHaveBeenCalled();
      },
    );
    it('denies guest requests', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/orders/${view}`)
        .expect(401);
      expect(findMany).not.toHaveBeenCalled();
    });
    it('denies a foreign shop and ignores target hints', async () => {
      await get(
        'e47f6994-a303-4a7b-87b0-2386d5198828',
        `?shopId=${shopId}`,
      ).expect(404);
      expect(findMany).not.toHaveBeenCalled();
    });
    it('denies removed membership', async () => {
      active = false;
      await get().expect(404);
      expect(findMany).not.toHaveBeenCalled();
    });
    it('rejects malformed IDs and cursor arrays', async () => {
      await get('bad-id').expect(400);
      await get(shopId, '?cursor=a&cursor=b').expect(400);
      expect(findMany).not.toHaveBeenCalled();
    });
  },
);
