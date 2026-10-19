import { Test } from '@nestjs/testing';
import { DiscoveryModule, DiscoveryService, Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import type { Response } from 'express';
import { of } from 'rxjs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  SHOP_ROLES,
  type ShopRole,
  type ShopPermission,
} from '@paserve/contracts';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { SHOP_PERMISSIONS_KEY } from '../src/modules/shop-members/decorators/permissions.decorator.js';
import { resetRateLimits } from './rate-limit-test-utils.js';

const management: readonly ShopRole[] = ['OWNER', 'ADMIN', 'MANAGER'];
const counter: readonly ShopRole[] = [...management, 'CASHIER'];
const kitchen: readonly ShopRole[] = [...management, 'KITCHEN'];
const owner: readonly ShopRole[] = ['OWNER'];
// Independent expectations: do not use the implementation's role lookup function.
const permissionRoles: Record<ShopPermission, readonly ShopRole[]> = {
  'shop.menu.manage': management,
  'shop.orders.manage': management,
  'shop.reports.read': management,
  'shop.daily-operations.manage': management,
  'shop.orders.qr.scan': counter,
  'shop.orders.read': counter,
  'shop.payments.record': counter,
  'shop.orders.confirm': counter,
  'shop.orders.reject': counter,
  'shop.menu.availability.update': counter,
  'shop.preparation.queue.read': kitchen,
  'shop.preparation.status.update': kitchen,
  'shop.operations.manage': ['OWNER', 'ADMIN'],
  'shop.settings.manage': owner,
  'shop.ownership.manage': owner,
  'shop.billing.manage': owner,
  'shop.staff.manage': owner,
  'shop.orders.overview.read': owner,
};
// Pin sensitive API actions independently of their declared permission metadata.
const pinned: Record<string, readonly ShopRole[]> = {
  'GET shops/:shopId/products': management,
  'POST shops/:shopId/products': management,
  'PATCH shops/:shopId/products/:productId': management,
  'PATCH shops/:shopId/products/:productId/available': counter,
  'POST shops/:shopId/products/:productId/image': management,
  'GET shops/:shopId/settings': owner,
  'PATCH shops/:shopId': owner,
  'POST shops/:shopId/logo': owner,
  'DELETE shops/:shopId/logo': owner,
  'POST shops/:shopId/banner': owner,
  'GET shops/:shopId/staff': owner,
  'POST shops/:shopId/staff/invitations': owner,
  'PATCH shops/:shopId/staff/members/:memberId': owner,
  'GET shops/:shopId/orders/:orderId/details': owner,
  'GET shops/:shopId/orders/active': owner,
  'GET shops/:shopId/reports/completed-sales': management,
  'POST shops/:shopId/orders/:orderId/confirm': counter,
  'POST shops/:shopId/orders/:orderId/reject': counter,
  'POST shops/:shopId/orders/:orderId/create-payment': counter,
  'GET shops/:shopId/preparation/queue': kitchen,
  'POST shops/:shopId/orders/:orderId/start-preparing': kitchen,
};

describe('Role actions on all registered shop API routes', () => {
  const actorId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const resourceId = 'a47f6994-a303-4a7b-87b0-2386d5198828';
  let app: INestApplication<App>;
  let role: ShopRole = 'OWNER';
  let disabled = false;
  const allowedBoundary = vi.fn();
  const membership = vi.fn();
  type Route = {
    label: string;
    url: string;
    method: 'get' | 'post' | 'patch' | 'delete' | 'put';
    roles: readonly ShopRole[];
  };
  const routes: Route[] = [];
  beforeAll(async () => {
    const findResource = vi.fn(async () => ({ id: resourceId, shopId }));
    const module = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        shopMember: { findUnique: membership },
        ...Object.fromEntries(
          [
            'product',
            'category',
            'addOn',
            'restaurantTable',
            'order',
            'orderItem',
            'staffInvitation',
            'staffAuditEvent',
          ].map((model) => [model, { findFirst: findResource }]),
        ),
      })
      .overrideProvider(AuthService)
      .useValue({
        currentUser: async () => ({
          id: actorId,
          memberships: [{ shopId, role: 'OWNER' }],
        }),
      })
      .compile();
    const reflector = module.get(Reflector);
    for (const { metatype } of module.get(DiscoveryService).getControllers()) {
      if (!metatype) continue;
      const base = Reflect.getMetadata(PATH_METADATA, metatype);
      if (typeof base !== 'string' || !base.startsWith('shops')) continue;
      for (const key of Object.getOwnPropertyNames(metatype.prototype)) {
        const handler = metatype.prototype[key];
        const methodId =
          typeof handler === 'function'
            ? Reflect.getMetadata(METHOD_METADATA, handler)
            : undefined;
        if (methodId === undefined) continue;
        const path =
          `${base}/${Reflect.getMetadata(PATH_METADATA, handler) ?? ''}`.replace(
            /\/+$/u,
            '',
          );
        if (!path.startsWith('shops/:shopId')) continue;
        const method = RequestMethod[methodId] as string;
        expect(['GET', 'POST', 'PATCH', 'DELETE', 'PUT'], path).toContain(
          method,
        );
        const label = `${method} ${path}`;
        let roles: readonly ShopRole[];
        if (pinned[label]) roles = pinned[label];
        else if (
          path === 'shops/:shopId/membership' ||
          path === 'shops/:shopId/orders/events'
        )
          roles = SHOP_ROLES;
        else {
          const permissions = reflector.getAllAndOverride<ShopPermission[]>(
            SHOP_PERMISSIONS_KEY,
            [handler, metatype],
          );
          expect(permissions?.length, label).toBeGreaterThan(0);
          for (const permission of permissions!)
            expect(permissionRoles, label).toHaveProperty(permission);
          roles = SHOP_ROLES.filter((r) =>
            permissions!.every((p) => permissionRoles[p].includes(r)),
          );
        }
        routes.push({
          label,
          method: method.toLowerCase() as Route['method'],
          url: `/api/v1/${path.replace(/:shopId\b/gu, shopId).replace(/:[a-zA-Z]+/gu, resourceId)}`,
          roles,
        });
      }
    }
    expect(routes.length).toBeGreaterThan(50);
    for (const label of Object.keys(pinned))
      expect(routes.map((r) => r.label)).toContain(label);
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // This test's boundary is authorization. Keep all real guards, but do not
    // execute business actions, stream subscriptions, uploads or DTO validation.
    app.useGlobalInterceptors({
      intercept: (context) => {
        allowedBoundary(context.getHandler());
        const response = context.switchToHttp().getResponse<Response>();
        response.setHeader('X-Role-Test-Allowed', 'true');
        // Raw-response stream controllers do not let Nest finish the response.
        const path = Reflect.getMetadata(PATH_METADATA, context.getHandler());
        if (['events', 'confirmed-events', 'preparation-events'].includes(path))
          response.status(200).json({ authorized: true });
        return of({ authorized: true });
      },
    });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    resetRateLimits(app);
    disabled = false;
    membership.mockImplementation(async ({ where }) => {
      const target = where.userId_shopId;
      if (target.userId !== actorId || target.shopId !== shopId) return null;
      return {
        id: 'live-member',
        shopId,
        role,
        disabledAt: disabled ? new Date() : null,
        user: { isActive: true },
        shop: { id: shopId, name: 'Cafe', slug: 'cafe', isActive: true },
      };
    });
  });

  it.each(SHOP_ROLES)(
    'enforces every allowed/forbidden action for live %s',
    async (liveRole) => {
      role = liveRole;
      for (const route of routes) {
        resetRateLimits(app);
        allowedBoundary.mockClear();
        const response = await request(app.getHttpServer())
          [route.method](route.url)
          .timeout({ response: 2000, deadline: 3000 })
          .set('Authorization', 'Bearer test')
          .set('X-Role', 'OWNER')
          .query({ role: 'OWNER' })
          .send({});
        if (route.roles.includes(role)) {
          expect(response.status, route.label).toBeGreaterThanOrEqual(200);
          expect(response.status, route.label).toBeLessThan(300);
          expect(response.headers['x-role-test-allowed'], route.label).toBe(
            'true',
          );
          expect(allowedBoundary, route.label).toHaveBeenCalledTimes(1);
        } else {
          expect(response.status, route.label).toBe(403);
          expect(
            response.headers['x-role-test-allowed'],
            route.label,
          ).toBeUndefined();
          expect(allowedBoundary, route.label).not.toHaveBeenCalled();
        }
      }
    },
  );
  it.each(SHOP_ROLES)(
    'rejects suspended %s across all actions despite cached owner claims',
    async (liveRole) => {
      role = liveRole;
      disabled = true;
      for (const route of routes) {
        resetRateLimits(app);
        allowedBoundary.mockClear();
        const response = await request(app.getHttpServer())
          [route.method](route.url)
          .timeout({ response: 2000, deadline: 3000 })
          .set('Authorization', 'Bearer test')
          .send({});
        expect(response.status, route.label).toBe(404);
        expect(allowedBoundary, route.label).not.toHaveBeenCalled();
      }
    },
  );
  it('uses a changed live role on the next request rather than cached OWNER claims', async () => {
    const route = routes.find((r) => r.label === 'GET shops/:shopId/settings')!;
    role = 'OWNER';
    await request(app.getHttpServer())
      .get(route.url)
      .set('Authorization', 'Bearer test')
      .expect(200);
    role = 'CASHIER';
    allowedBoundary.mockClear();
    await request(app.getHttpServer())
      .get(route.url)
      .set('Authorization', 'Bearer test')
      .expect(403);
    expect(allowedBoundary).not.toHaveBeenCalled();
  });
  it('rejects guests across all shop actions before the authorization boundary', async () => {
    for (const route of routes) {
      resetRateLimits(app);
      allowedBoundary.mockClear();
      const response = await request(app.getHttpServer())
        [route.method](route.url)
        .timeout({ response: 2000, deadline: 3000 })
        .set('X-Role', 'OWNER')
        .send({});
      expect(response.status, route.label).toBe(401);
      expect(allowedBoundary, route.label).not.toHaveBeenCalled();
    }
  });
  it('records route coverage for the verification report', () => {
    console.log(
      `Role HTTP coverage: ${routes.length} registered shop routes x ${SHOP_ROLES.length} roles; ${routes.length * SHOP_ROLES.length} permission cases and ${routes.length * SHOP_ROLES.length} suspended membership cases.`,
    );
  });
});
