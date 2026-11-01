import { WalkthroughService } from './walkthrough.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { CurrentUser } from '@paserve/contracts';
const prisma = { walkthroughProgress: { findMany: vi.fn(), upsert: vi.fn() } };
let service: WalkthroughService;
const user = {
  id: 'self',
  memberships: [
    { shopId: 'shop-a', role: 'CASHIER', shop: { isActive: true } },
  ],
} as CurrentUser;
beforeEach(() => {
  vi.resetAllMocks();
  service = new WalkthroughService(prisma as unknown as PrismaService);
});
it("lists only this account's progress for the current walkthrough version", async () => {
  prisma.walkthroughProgress.findMany.mockResolvedValue([{ scope: 'account' }]);
  await expect(service.progress('self')).resolves.toEqual({
    completedScopes: ['account'],
  });
  expect(prisma.walkthroughProgress.findMany).toHaveBeenCalledWith({
    where: { userId: 'self', version: 1 },
    select: { scope: true },
    take: 1000,
  });
});
it('saves skip/completion idempotently for the authenticated identity', async () => {
  await service.complete(user, { kind: 'account', outcome: 'skipped' });
  expect(prisma.walkthroughProgress.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        userId_scope_version: { userId: 'self', scope: 'account', version: 1 },
      },
      create: {
        userId: 'self',
        scope: 'account',
        version: 1,
        outcome: 'skipped',
      },
    }),
  );
});
it('derives the shop role from the live membership', async () => {
  await expect(
    service.complete(user, {
      kind: 'shop',
      shopId: 'shop-a',
      outcome: 'completed',
    }),
  ).resolves.toEqual({ scope: 'shop:shop-a:CASHIER' });
  expect(prisma.walkthroughProgress.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        userId_scope_version: {
          userId: 'self',
          scope: 'shop:shop-a:CASHIER',
          version: 1,
        },
      },
    }),
  );
});
it('rejects unavailable/cross-shop contexts without storing progress', async () => {
  await expect(
    service.complete(user, {
      kind: 'shop',
      shopId: 'other',
      outcome: 'completed',
    }),
  ).rejects.toThrow();
  await expect(
    service.complete(user, { kind: 'shop', outcome: 'skipped' }),
  ).rejects.toThrow();
  await expect(
    service.complete(
      { ...user, memberships: [] },
      { kind: 'shop', shopId: 'shop-a', outcome: 'skipped' },
    ),
  ).rejects.toThrow();
  expect(prisma.walkthroughProgress.upsert).not.toHaveBeenCalled();
});
it('does not allow a shop parameter to modify the account scope', async () => {
  await expect(
    service.complete(user, {
      kind: 'account',
      shopId: 'shop-a',
      outcome: 'skipped',
    }),
  ).rejects.toThrow();
  expect(prisma.walkthroughProgress.upsert).not.toHaveBeenCalled();
});
