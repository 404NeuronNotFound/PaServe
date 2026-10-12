import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ShopResourceGuard } from './shop-resource.guard.js';
import type { TenantResourcesService } from './tenant-resources.service.js';

describe('ShopResourceGuard', () => {
  const resources = { requireResource: vi.fn() };
  const guard = new ShopResourceGuard(
    new Reflector(),
    resources as unknown as TenantResourcesService,
  );
  let request: {
    user?: { id: string };
    params: { shopId: string; resourceId: string };
    shopResource?: unknown;
    shopMembership?: unknown;
  };
  let handler: () => void;
  let context: ExecutionContext;
  beforeEach(() => {
    vi.resetAllMocks();
    handler = () => {};
    request = {
      user: { id: 'actor' },
      params: { shopId: 'route-shop', resourceId: 'route-resource' },
    };
    context = {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  });

  it.each(['product', 'order'] as const)(
    'attaches validated %s route context and ignores existing injected context',
    async (kind) => {
      Reflect.defineMetadata(
        'paserve:shop-resource',
        { kind, parameter: 'resourceId' },
        handler,
      );
      request.shopResource = { id: 'injected', shopId: 'injected' };
      const result = {
        membership: { shopId: 'route-shop' },
        resource: { id: 'route-resource', shopId: 'route-shop', kind },
      };
      resources.requireResource.mockResolvedValue(result);
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(resources.requireResource).toHaveBeenCalledWith(
        'actor',
        'route-shop',
        kind,
        'route-resource',
      );
      expect(request.shopResource).toEqual(result.resource);
      expect(request.shopMembership).toEqual(result.membership);
    },
  );

  it.each([
    undefined,
    null,
    { kind: 'unregistered', parameter: 'resourceId' },
    { kind: 'product', parameter: '' },
    { kind: 'product', parameter: 'shopId' },
  ])('fails closed for invalid resource metadata (%j)', async (policy) => {
    Reflect.defineMetadata('paserve:shop-resource', policy, handler);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 403,
      response: { code: 'RESOURCE_POLICY_REQUIRED' },
    });
    expect(resources.requireResource).not.toHaveBeenCalled();
  });

  it('rejects missing authentication before resource checks', async () => {
    delete request.user;
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 401,
    });
    expect(resources.requireResource).not.toHaveBeenCalled();
  });

  it('propagates a failed ownership check without attaching resource context', async () => {
    Reflect.defineMetadata(
      'paserve:shop-resource',
      { kind: 'category', parameter: 'resourceId' },
      handler,
    );
    resources.requireResource.mockRejectedValue({ status: 404 });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 404,
    });
    expect(request.shopResource).toBeUndefined();
  });
});
