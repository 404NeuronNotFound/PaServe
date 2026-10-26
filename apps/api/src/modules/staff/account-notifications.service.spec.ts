import { AccountNotificationsService } from './account-notifications.service.js';
import type { PrismaService } from '../../database/prisma.service.js';

describe('Account inbox privacy', () => {
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const noticeId = '85992537-5d60-4d22-8e1e-60a114644681';
  const db = {
    user: { findFirst: vi.fn() },
    accountNotification: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    staffInvitation: { findMany: vi.fn() },
  };
  const service = new AccountNotificationsService(
    db as unknown as PrismaService,
  );
  const scope = {
    OR: [
      { recipientUserId: userId },
      { recipientUserId: null, recipientEmail: 'person@example.com' },
    ],
  };
  beforeEach(() => {
    vi.resetAllMocks();
    db.user.findFirst.mockResolvedValue({ email: 'person@example.com' });
    db.accountNotification.findMany.mockResolvedValue([]);
    db.accountNotification.count.mockResolvedValue(0);
    db.staffInvitation.findMany.mockResolvedValue([]);
  });
  it('scopes list and unread totals to the authenticated user, including email invitations', async () => {
    await service.list(userId);
    expect(
      db.accountNotification.findMany.mock.calls[0][0].where.AND[0],
    ).toEqual(scope);
    expect(db.accountNotification.count).toHaveBeenCalledWith({
      where: { AND: [scope, { readAt: null }] },
    });
  });
  it('scopes mark-all and individual writes rather than trusting notification IDs', async () => {
    db.accountNotification.updateMany.mockResolvedValue({ count: 1 });
    await service.markRead(userId);
    await service.markRead(userId, noticeId);
    expect(db.accountNotification.updateMany.mock.calls[0][0].where).toEqual({
      AND: [scope, { readAt: null }],
    });
    expect(db.accountNotification.updateMany.mock.calls[1][0].where).toEqual({
      AND: [scope, { id: noticeId, readAt: null }],
    });
  });
  it('rejects another account’s cursor or read target', async () => {
    db.accountNotification.findFirst.mockResolvedValue(null);
    db.accountNotification.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.list(userId, noticeId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.markRead(userId, noticeId)).rejects.toMatchObject({
      status: 404,
    });
    expect(db.accountNotification.findFirst).toHaveBeenCalledWith({
      where: { AND: [scope, { id: noticeId }] },
    });
  });
  it('does not expose an inbox for an inactive or missing account', async () => {
    db.user.findFirst.mockResolvedValue(null);
    await expect(service.list(userId)).rejects.toMatchObject({ status: 404 });
    expect(db.accountNotification.findMany).not.toHaveBeenCalled();
  });
  it('bounds pages and returns stable cursor pagination', async () => {
    const rows = Array.from({ length: 31 }, (_, i) => ({
      id: `notification-${i}`,
      kind: 'REMOVED',
      shopId: 'shop',
      shopName: 'Shop',
      actorName: 'Owner',
      role: null,
      previousRole: 'CASHIER',
      createdAt: new Date(),
      readAt: null,
    }));
    db.accountNotification.findMany.mockResolvedValue(rows);
    const result = await service.list(userId);
    expect(result.notifications).toHaveLength(30);
    expect(result.nextCursor).toBe(rows[29].id);
  });
});
