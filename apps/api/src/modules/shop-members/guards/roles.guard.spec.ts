import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';
import { SHOP_ROLES_KEY } from '../roles.metadata.js';
import type { ShopMembersService } from '../shop-members.service.js';

describe('RolesGuard', () => {
  const memberships = { requireMembership: vi.fn() };
  const guard = new RolesGuard(
    new Reflector(),
    memberships as unknown as ShopMembersService,
  );
  const membership = {
    id: 'live-member',
    shopId: 'target-shop',
    role: 'ADMIN',
    shop: { id: 'target-shop', isActive: true },
  };
  let handler: () => void;
  let controller: new () => object;
  let request: {
    user?: { id: string };
    params: { shopId?: unknown };
    shopMembership?: unknown;
  };
  let context: ExecutionContext;
  beforeEach(() => {
    vi.resetAllMocks();
    handler = () => {};
    controller = class {};
    request = { user: { id: 'user-id' }, params: { shopId: 'target-shop' } };
    context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => controller,
    } as unknown as ExecutionContext;
    memberships.requireMembership.mockResolvedValue(membership);
  });

  it('ignores an injected membership and uses the exact live target', async () => {
    Reflect.defineMetadata(SHOP_ROLES_KEY, ['ADMIN'], handler);
    request.shopMembership = { role: 'OWNER', shopId: 'other-shop' };
    expect(await guard.canActivate(context)).toBe(true);
    expect(memberships.requireMembership).toHaveBeenCalledWith(
      'user-id',
      'target-shop',
    );
    expect(request.shopMembership).toEqual(membership);
  });

  it('lets handler policy override a controller policy', async () => {
    Reflect.defineMetadata(SHOP_ROLES_KEY, ['OWNER'], controller);
    Reflect.defineMetadata(SHOP_ROLES_KEY, ['ADMIN'], handler);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('uses a controller policy when the handler has no policy', async () => {
    Reflect.defineMetadata(SHOP_ROLES_KEY, ['ADMIN'], controller);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it.each([undefined, [], 'ADMIN', ['SUPER_ADMIN'], ['OWNER', null]])(
    'fails closed for missing/invalid role policy (%j)',
    async (roles) => {
      Reflect.defineMetadata(SHOP_ROLES_KEY, roles, handler);
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: 403,
        response: { code: 'SHOP_ROLE_POLICY_REQUIRED' },
      });
      expect(memberships.requireMembership).not.toHaveBeenCalled();
    },
  );

  it('does not inherit class access through an empty handler policy', async () => {
    Reflect.defineMetadata(SHOP_ROLES_KEY, ['ADMIN'], controller);
    Reflect.defineMetadata(SHOP_ROLES_KEY, [], handler);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects requests without authentication before membership lookup', async () => {
    Reflect.defineMetadata(SHOP_ROLES_KEY, ['ADMIN'], handler);
    delete request.user;
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 401,
    });
    expect(memberships.requireMembership).not.toHaveBeenCalled();
  });

  it.each([undefined, ['other-shop'], 42])(
    'sends an invalid target to membership validation (%j)',
    async (shopId) => {
      Reflect.defineMetadata(SHOP_ROLES_KEY, ['ADMIN'], handler);
      request.params.shopId = shopId;
      memberships.requireMembership.mockRejectedValue({ status: 400 });
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: 400,
      });
      expect(memberships.requireMembership).toHaveBeenCalledWith('user-id', '');
    },
  );

  it('keeps owner-only denial responses compatible', async () => {
    Reflect.defineMetadata(SHOP_ROLES_KEY, ['OWNER'], handler);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 403,
      response: { code: 'OWNER_REQUIRED' },
    });
  });

  it('requires an exact allowed role without implicit OWNER bypass', async () => {
    Reflect.defineMetadata(SHOP_ROLES_KEY, ['ADMIN'], handler);
    memberships.requireMembership.mockResolvedValue({
      ...membership,
      role: 'OWNER',
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 403,
      response: { code: 'SHOP_ROLE_REQUIRED' },
    });
    expect(request.shopMembership).toBeUndefined();
  });
});
