import type { ExecutionContext } from '@nestjs/common';
import { ShopMembershipGuard } from './shop-membership.guard.js';
import type { ShopMembersService } from '../shop-members.service.js';

describe('ShopMembershipGuard', () => {
  const service = { requireMembership: vi.fn() };
  const guard = new ShopMembershipGuard(
    service as unknown as ShopMembersService,
  );
  let request: {
    user?: { id: string };
    params: { shopId?: unknown };
    shopMembership?: unknown;
  };
  let context: ExecutionContext;
  beforeEach(() => {
    vi.resetAllMocks();
    request = {
      user: { id: 'authenticated-user' },
      params: { shopId: 'target-shop' },
    };
    context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  });

  it('overwrites injected context using the authenticated identity and exact route target', async () => {
    request.shopMembership = { shopId: 'other-shop', role: 'OWNER' };
    const live = { shopId: 'target-shop', role: 'KITCHEN' };
    service.requireMembership.mockResolvedValue(live);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(service.requireMembership).toHaveBeenCalledWith(
      'authenticated-user',
      'target-shop',
    );
    expect(request.shopMembership).toEqual(live);
  });

  it('rejects unauthenticated requests without a membership query', async () => {
    delete request.user;
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 401,
    });
    expect(service.requireMembership).not.toHaveBeenCalled();
  });

  it.each([undefined, [], 42])(
    'fails membership validation for invalid route target (%j)',
    async (shopId) => {
      request.params.shopId = shopId;
      service.requireMembership.mockRejectedValue({ status: 400 });
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: 400,
      });
      expect(service.requireMembership).toHaveBeenCalledWith(
        'authenticated-user',
        '',
      );
    },
  );

  it.each([404, 500])(
    'propagates failed live validation (%s) without attaching context',
    async (status) => {
      service.requireMembership.mockRejectedValue({ status });
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status,
      });
      expect(request.shopMembership).toBeUndefined();
    },
  );
});
