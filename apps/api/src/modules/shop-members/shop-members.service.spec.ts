import { ShopMembersService } from './shop-members.service.js';
import { ShopMembersRepository } from './shop-members.repository.js';

describe('ShopMembersService', () => {
  const shopId = 'a0408a16-44c4-4eb4-a438-52c791a216be';
  const repository = { findMembership: vi.fn() };
  const service = new ShopMembersService(
    repository as unknown as ShopMembersRepository,
  );
  const record = {
    id: 'member-id',
    shopId,
    role: 'OWNER',
    userId: 'user-id',
    user: { isActive: true, passwordHash: 'private' },
    shop: {
      id: shopId,
      name: 'Cafe',
      slug: 'cafe',
      isActive: true,
      privateData: 'private',
    },
  };
  beforeEach(() => {
    vi.resetAllMocks();
    repository.findMembership.mockResolvedValue(record);
  });

  it('returns only the current user’s shop relationship and safe shop fields', async () => {
    await expect(service.requireMembership('user-id', shopId)).resolves.toEqual(
      {
        id: 'member-id',
        shopId,
        role: 'OWNER',
        shop: { id: shopId, name: 'Cafe', slug: 'cafe', isActive: true },
      },
    );
    expect(repository.findMembership).toHaveBeenCalledWith('user-id', shopId);
  });

  it.each(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN'])(
    'reads the live %s role from the join record',
    async (role) => {
      repository.findMembership.mockResolvedValue({ ...record, role });
      expect((await service.requireMembership('user-id', shopId)).role).toBe(
        role,
      );
    },
  );

  it.each(['', 'not-a-uuid', '../other-shop'])(
    'rejects an invalid shop identifier before database access (%s)',
    async (id) => {
      await expect(
        service.requireMembership('user-id', id),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_SHOP_ID' },
      });
      expect(repository.findMembership).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { ...record, shop: { ...record.shop, isActive: false } },
    { ...record, user: { ...record.user, isActive: false } },
  ])(
    'denies missing or inactive relationships with the same safe response',
    async (membership) => {
      repository.findMembership.mockResolvedValue(membership);
      await expect(
        service.requireMembership('user-id', shopId),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: 'SHOP_NOT_ACCESSIBLE' },
      });
    },
  );
});
