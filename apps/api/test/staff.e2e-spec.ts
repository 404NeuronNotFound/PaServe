import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { ShopRole, StaffRole } from '@paserve/contracts';
import { createHash } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { StaffService } from '../src/modules/staff/staff.service.js';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

describe('Owner staff invitations through HTTP', () => {
  const ownerId = '75992537-5d60-4d22-8e1e-60a114644681';
  const userId = '85992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const foreignShop = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const resourceId = 'e47f6994-a303-4a7b-87b0-2386d5198828';
  const token = 'a'.repeat(64);
  const currentUser = vi.fn();
  const membership = vi.fn();
  const tx = {
    $queryRaw: vi.fn(),
    shop: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    shopMember: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    staffInvitation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    staffAuditEvent: { create: vi.fn() },
  };
  const transaction = vi.fn();
  let app: INestApplication<App>;
  let role: ShopRole;
  let invite: {
    id: string;
    shopId: string;
    email: string;
    role: ShopRole;
    tokenHash: string;
    invitedBy: string;
    expiresAt: Date;
    revokedAt: Date | null;
    acceptedAt: Date | null;
    acceptedBy: string | null;
    createdAt: Date;
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        shopMember: { findUnique: membership },
        $transaction: transaction,
      })
      .overrideProvider(AuthService)
      .useValue({ currentUser })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
    role = 'OWNER';
    invite = {
      id: resourceId,
      shopId,
      email: 'cashier@example.com',
      role: 'CASHIER',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      invitedBy: ownerId,
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
      acceptedAt: null,
      acceptedBy: null,
      createdAt: new Date(),
    };
    currentUser.mockImplementation(async (credential: string) => ({
      id: credential === 'invitee' ? userId : ownerId,
      memberships: [{ shopId, role: 'OWNER' }],
    }));
    membership.mockImplementation(async ({ where }) =>
      where.userId_shopId.shopId === shopId
        ? {
            id: resourceId,
            shopId,
            role,
            user: { isActive: true },
            shop: { id: shopId, name: 'Cafe', slug: 'cafe', isActive: true },
          }
        : null,
    );
    transaction.mockImplementation(async (callback) => callback(tx));
    tx.$queryRaw.mockResolvedValue([{ id: shopId }]);
    tx.shop.findFirst.mockResolvedValue({ id: shopId, name: 'Cafe A' });
    tx.user.findFirst.mockResolvedValue({ email: 'cashier@example.com' });
    tx.shopMember.findFirst.mockResolvedValue(null);
    tx.shopMember.findMany.mockResolvedValue([]);
    tx.staffInvitation.findMany.mockResolvedValue([]);
    tx.staffInvitation.findFirst.mockImplementation(async ({ where }) =>
      where.shopId === shopId &&
      (!where.tokenHash || where.tokenHash === invite.tokenHash)
        ? invite
        : null,
    );
    tx.staffInvitation.create.mockImplementation(async ({ data }) => ({
      ...invite,
      ...data,
    }));
    tx.staffInvitation.updateMany.mockResolvedValue({ count: 1 });
    tx.shopMember.updateMany.mockResolvedValue({ count: 1 });
    tx.shopMember.deleteMany.mockResolvedValue({ count: 1 });
  });
  const owner = () => request(app.getHttpServer());
  const accept = (targetShop = shopId, credential = token) =>
    owner()
      .post(`/api/v1/staff-invitations/${targetShop}/accept`)
      .set('Authorization', 'Bearer invitee')
      .send({ token: credential });
  const actions = [
    ['get', ''],
    ['post', '/invitations'],
    ['delete', `/invitations/${resourceId}`],
    ['patch', `/members/${resourceId}`],
    ['patch', `/members/${resourceId}/access`],
    ['delete', `/members/${resourceId}`],
  ] as const;
  it.each(['ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN'] as const)(
    'denies %s every owner staff action despite cached OWNER claims',
    async (deniedRole) => {
      role = deniedRole;
      for (const [method, suffix] of actions)
        await owner()
          [method](`/api/v1/shops/${shopId}/staff${suffix}`)
          .set('Authorization', 'Bearer owner')
          .send({ email: 'cashier@example.com', role: 'CASHIER' })
          .expect(403);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('requires authentication for every staff action and acceptance', async () => {
    for (const [method, suffix] of actions)
      await owner()
        [method](`/api/v1/shops/${shopId}/staff${suffix}`)
        .send({})
        .expect(401);
    await owner()
      .post(`/api/v1/staff-invitations/${shopId}/accept`)
      .send({ token })
      .expect(401);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('hides foreign shops from an owner of another shop', async () => {
    await owner()
      .get(`/api/v1/shops/${foreignShop}/staff`)
      .set('Authorization', 'Bearer owner')
      .expect(404);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rechecks live owner access after the guard', async () => {
    tx.shop.findFirst.mockResolvedValue(null);
    await owner()
      .post(`/api/v1/shops/${shopId}/staff/invitations`)
      .set('Authorization', 'Bearer owner')
      .send({ email: 'cashier@example.com', role: 'CASHIER' })
      .expect(403);
    expect(tx.staffInvitation.create).not.toHaveBeenCalled();
  });
  it.each([
    { code: '40001' },
    { driverAdapterError: { cause: { originalCode: '40P01' } } },
  ])(
    'retries a rolled-back raw lock conflict %j without duplicate writes',
    async (meta) => {
      transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Lock conflict', {
          code: 'P2010',
          clientVersion: 'test',
          meta,
        }),
      );
      await owner()
        .post(`/api/v1/shops/${shopId}/staff/invitations`)
        .set('Authorization', 'Bearer owner')
        .send({ email: 'cashier@example.com', role: 'CASHIER' })
        .expect(201);
      expect(transaction).toHaveBeenCalledTimes(2);
      expect(tx.staffInvitation.create).toHaveBeenCalledTimes(1);
    },
  );
  it('returns a retryable conflict after repeated serialization failures', async () => {
    transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Serialization conflict', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    );
    await owner()
      .post(`/api/v1/shops/${shopId}/staff/invitations`)
      .set('Authorization', 'Bearer owner')
      .send({ email: 'cashier@example.com', role: 'CASHIER' })
      .expect(409);
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(tx.staffInvitation.create).not.toHaveBeenCalled();
  });
  it('creates a normalized invitation, stores only its digest, and audits it', async () => {
    const result = await owner()
      .post(`/api/v1/shops/${shopId}/staff/invitations`)
      .set('Authorization', 'Bearer owner')
      .send({ email: ' Cashier@EXAMPLE.com ', role: 'CASHIER' })
      .expect(201);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.body.invitation.email).toBe('cashier@example.com');
    expect(result.body.invitation.tokenHash).toBeUndefined();
    expect(tx.staffInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shopId,
        email: 'cashier@example.com',
        invitedBy: ownerId,
        tokenHash: createHash('sha256').update(result.body.token).digest('hex'),
      }),
    });
    expect(tx.staffAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: ownerId,
        action: 'INVITED',
        shopId,
      }),
    });
  });
  it.each([
    { email: 'bad', role: 'CASHIER' },
    { email: 'barista@example.com', role: 'BARISTA' },
    { email: 'cashier@example.com', role: 'OWNER' },
    { email: 'cashier@example.com', role: 'CASHIER', shopId: foreignShop },
  ])(
    'rejects invalid or privilege-changing invitation payload %j',
    async (body) => {
      await owner()
        .post(`/api/v1/shops/${shopId}/staff/invitations`)
        .set('Authorization', 'Bearer owner')
        .send(body)
        .expect(400);
      expect(tx.staffInvitation.create).not.toHaveBeenCalled();
    },
  );
  it('does not invite an existing member or silently overwrite their role', async () => {
    tx.shopMember.findFirst.mockResolvedValue({
      id: resourceId,
      role: 'KITCHEN',
    });
    await owner()
      .post(`/api/v1/shops/${shopId}/staff/invitations`)
      .set('Authorization', 'Bearer owner')
      .send({ email: 'cashier@example.com', role: 'CASHIER' })
      .expect(409);
    expect(tx.staffInvitation.create).not.toHaveBeenCalled();
  });
  it('does not expose credential hashes in the staff list', async () => {
    tx.staffInvitation.findMany.mockResolvedValue([invite]);
    const result = await owner()
      .get(`/api/v1/shops/${shopId}/staff`)
      .set('Authorization', 'Bearer owner')
      .expect(200);
    expect(result.body.invitations[0].status).toBe('PENDING');
    expect(JSON.stringify(result.body)).not.toContain(invite.tokenHash);
    expect(result.body.invitations[0].invitedBy).toBeUndefined();
  });
  it('accepts the stored role atomically for the invited account', async () => {
    const result = await accept().expect(200);
    expect(result.body).toEqual({ shopId, role: 'CASHIER' });
    expect(tx.shopMember.create).toHaveBeenCalledWith({
      data: { shopId, userId, role: 'CASHIER' },
    });
    expect(tx.staffInvitation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        shopId,
        tokenHash: invite.tokenHash,
        acceptedAt: null,
        revokedAt: null,
      }),
      data: expect.objectContaining({ acceptedBy: userId }),
    });
    expect(tx.staffAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ACCEPTED',
        actorId: userId,
        shopId,
      }),
    });
  });
  it('previews the verified shop and role without consuming the invitation', async () => {
    const result = await owner()
      .post(`/api/v1/staff-invitations/${shopId}/preview`)
      .set('Authorization', 'Bearer invitee')
      .send({ token })
      .expect(200);
    expect(result.body).toMatchObject({
      shopId,
      shopName: 'Cafe A',
      email: invite.email,
      role: 'CASHIER',
    });
    expect(tx.shopMember.create).not.toHaveBeenCalled();
    expect(tx.staffInvitation.updateMany).not.toHaveBeenCalled();
    tx.user.findFirst.mockResolvedValue({ email: 'wrong@example.com' });
    await owner()
      .post(`/api/v1/staff-invitations/${shopId}/preview`)
      .set('Authorization', 'Bearer invitee')
      .send({ token })
      .expect(403);
  });
  it.each([
    'email',
    'expired',
    'revoked',
    'foreignShop',
    'altered',
    'issuer',
    'existing',
  ])('blocks %s acceptance without creating membership', async (kind) => {
    if (kind === 'email')
      tx.user.findFirst.mockResolvedValue({ email: 'wrong@example.com' });
    if (kind === 'expired') invite.expiresAt = new Date(0);
    if (kind === 'revoked') invite.revokedAt = new Date();
    if (kind === 'issuer') tx.shop.findFirst.mockResolvedValue(null);
    if (kind === 'existing')
      tx.shopMember.findFirst.mockResolvedValue({ role: 'KITCHEN' });
    await accept(
      kind === 'foreignShop' ? foreignShop : shopId,
      kind === 'altered' ? 'b'.repeat(64) : token,
    ).expect(kind === 'email' ? 403 : kind === 'existing' ? 409 : 404);
    expect(tx.shopMember.create).not.toHaveBeenCalled();
  });
  it('rejects preview and acceptance after successful acceptance, including for the original recipient', async () => {
    tx.staffInvitation.updateMany.mockImplementationOnce(async ({ data }) => {
      invite.acceptedAt = data.acceptedAt;
      invite.acceptedBy = data.acceptedBy;
      return { count: 1 };
    });
    tx.shopMember.create.mockImplementationOnce(async () => {
      tx.shopMember.findFirst.mockResolvedValue({ role: 'CASHIER' });
    });
    await accept().expect(200);
    for (const action of ['preview', 'accept']) {
      const response = await owner()
        .post(`/api/v1/staff-invitations/${shopId}/${action}`)
        .set('Authorization', 'Bearer invitee')
        .send({ token })
        .expect(404);
      expect(response.body.code).toBe('INVITATION_UNAVAILABLE');
    }
    expect(tx.staffInvitation.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.shopMember.create).toHaveBeenCalledTimes(1);
    expect(tx.staffAuditEvent.create).toHaveBeenCalledTimes(1);
  });

  it.each(['preview', 'accept'])(
    'rejects an expired invitation during %s',
    async (action) => {
      invite.expiresAt = new Date(0);
      await owner()
        .post(`/api/v1/staff-invitations/${shopId}/${action}`)
        .set('Authorization', 'Bearer invitee')
        .send({ token })
        .expect(404);
      expect(tx.staffInvitation.updateMany).not.toHaveBeenCalled();
      expect(tx.shopMember.create).not.toHaveBeenCalled();
    },
  );
  it.each([null, { role: 'KITCHEN' }])(
    'does not replay acceptance to restore removed or changed membership %j',
    async (existing) => {
      invite.acceptedAt = new Date();
      invite.acceptedBy = userId;
      tx.shopMember.findFirst.mockResolvedValue(existing);
      await accept().expect(404);
      expect(tx.shopMember.create).not.toHaveBeenCalled();
    },
  );
  it('blocks a consumed-token race before inserting a membership', async () => {
    tx.staffInvitation.updateMany.mockResolvedValue({ count: 0 });
    await accept().expect(404);
    expect(tx.shopMember.create).not.toHaveBeenCalled();
  });
  it.each([
    ['patch', 'ADMIN'],
    ['patch', 'MANAGER'],
    ['patch', 'CASHIER'],
    ['patch', 'KITCHEN'],
    ['delete', 'CASHIER'],
  ] as const)(
    'protects both own and other owner membership from %s (%s)',
    async (method, nextRole) => {
      for (const targetUserId of [ownerId, userId]) {
        tx.shopMember.findFirst.mockResolvedValue({
          userId: targetUserId,
          role: 'OWNER',
          user: { email: 'owner@example.com' },
        });
        const response = await owner()
          [method](`/api/v1/shops/${shopId}/staff/members/${resourceId}`)
          .set('Authorization', 'Bearer owner')
          .send({ role: nextRole })
          .expect(403);
        expect(response.body.code).toBe('OWNER_PROTECTED');
      }
      expect(tx.shopMember.updateMany).not.toHaveBeenCalled();
      expect(tx.shopMember.deleteMany).not.toHaveBeenCalled();
      expect(tx.staffAuditEvent.create).not.toHaveBeenCalled();
    },
  );

  it('rejects attempts to assign OWNER through the role-change endpoint', async () => {
    await owner()
      .patch(`/api/v1/shops/${shopId}/staff/members/${resourceId}`)
      .set('Authorization', 'Bearer owner')
      .send({ role: 'OWNER' })
      .expect(400);
    expect(tx.shopMember.updateMany).not.toHaveBeenCalled();
  });

  it('rejects ownership assignment by direct staff-service callers', async () => {
    const service = app.get(StaffService);
    tx.shopMember.findFirst.mockResolvedValue({
      userId,
      role: 'CASHIER',
      user: { email: invite.email },
    });
    for (const role of ['OWNER', 'SUPER_ADMIN'] as StaffRole[]) {
      await expect(
        service.invite(ownerId, shopId, { email: invite.email, role }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_STAFF_ROLE' } });
      await expect(
        service.changeRole(ownerId, shopId, resourceId, { role }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_STAFF_ROLE' } });
    }
    expect(tx.staffInvitation.create).not.toHaveBeenCalled();
    expect(tx.shopMember.updateMany).not.toHaveBeenCalled();
    expect(tx.staffAuditEvent.create).not.toHaveBeenCalled();
  });
  it('changes a nonowner role with shop and old-role predicates and an audit', async () => {
    tx.shopMember.findFirst.mockResolvedValue({
      userId,
      role: 'KITCHEN',
      user: { email: invite.email },
    });
    await owner()
      .patch(`/api/v1/shops/${shopId}/staff/members/${resourceId}`)
      .set('Authorization', 'Bearer owner')
      .send({ role: 'CASHIER' })
      .expect(204);
    expect(tx.shopMember.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: resourceId,
        shopId,
        role: 'KITCHEN',
      }),
      data: { role: 'CASHIER' },
    });
    expect(tx.staffAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ROLE_CHANGED',
        previousRole: 'KITCHEN',
        role: 'CASHIER',
        shopId,
      }),
    });
  });

  it.each([
    ['CASHIER', 'ADMIN'],
    ['MANAGER', 'ADMIN'],
    ['KITCHEN', 'ADMIN'],
    ['ADMIN', 'MANAGER'],
    ['ADMIN', 'CASHIER'],
    ['ADMIN', 'KITCHEN'],
    ['CASHIER', 'MANAGER'],
    ['KITCHEN', 'MANAGER'],
    ['MANAGER', 'CASHIER'],
    ['MANAGER', 'KITCHEN'],
    ['KITCHEN', 'CASHIER'],
    ['CASHIER', 'KITCHEN'],
  ] as const)(
    'allows OWNER to change %s to %s and audits the role transition',
    async (previousRole, nextRole) => {
      tx.shopMember.findFirst.mockResolvedValue({
        userId,
        role: previousRole,
        user: { email: invite.email },
      });
      await owner()
        .patch(`/api/v1/shops/${shopId}/staff/members/${resourceId}`)
        .set('Authorization', 'Bearer owner')
        .send({ role: nextRole })
        .expect(204);
      expect(tx.shopMember.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: resourceId,
          shopId,
          role: previousRole,
        }),
        data: { role: nextRole },
      });
      expect(tx.staffAuditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId,
          actorId: ownerId,
          targetUserId: userId,
          action: 'ROLE_CHANGED',
          previousRole,
          role: nextRole,
        }),
      });
      expect(tx.shopMember.deleteMany).not.toHaveBeenCalled();
    },
  );

  it.each(['ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN'] as const)(
    'allows inviting %s without granting membership before acceptance',
    async (role) => {
      const response = await owner()
        .post(`/api/v1/shops/${shopId}/staff/invitations`)
        .set('Authorization', 'Bearer owner')
        .send({ email: invite.email, role })
        .expect(201);
      expect(response.body.invitation.role).toBe(role);
      expect(tx.shopMember.create).not.toHaveBeenCalled();
    },
  );

  it.each(['ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN'] as const)(
    'creates %s membership only when the invited account accepts',
    async (role) => {
      invite.role = role;
      const response = await accept().expect(200);
      expect(response.body).toEqual({ shopId, role });
      expect(tx.shopMember.create).toHaveBeenCalledWith({
        data: { shopId, userId, role },
      });
    },
  );

  it.each(['OWNER', 'ADMIN'] as const)(
    'rejects %s claims when live ownership is lost during admin assignment',
    async (claimedRole) => {
      role = claimedRole;
      tx.shopMember.findFirst.mockResolvedValue({
        userId,
        role: 'CASHIER',
        user: { email: invite.email },
      });
      tx.shop.findFirst.mockResolvedValue(null);
      await owner()
        .patch(`/api/v1/shops/${shopId}/staff/members/${resourceId}`)
        .set('Authorization', 'Bearer owner')
        .send({ role: 'ADMIN' })
        .expect(403);
      expect(tx.shopMember.updateMany).not.toHaveBeenCalled();
      expect(tx.staffAuditEvent.create).not.toHaveBeenCalled();
    },
  );

  it('rejects an admin change targeting a member outside the selected shop', async () => {
    tx.shopMember.findFirst.mockResolvedValue(null);
    await owner()
      .patch(`/api/v1/shops/${shopId}/staff/members/${resourceId}`)
      .set('Authorization', 'Bearer owner')
      .send({ role: 'ADMIN' })
      .expect(404);
    expect(tx.shopMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: resourceId, shopId } }),
    );
    expect(tx.shopMember.updateMany).not.toHaveBeenCalled();
  });

  it('does not audit admin assignment if the conditional membership update fails', async () => {
    tx.shopMember.findFirst.mockResolvedValue({
      userId,
      role: 'CASHIER',
      user: { email: invite.email },
    });
    tx.shopMember.updateMany.mockResolvedValue({ count: 0 });
    await owner()
      .patch(`/api/v1/shops/${shopId}/staff/members/${resourceId}`)
      .set('Authorization', 'Bearer owner')
      .send({ role: 'ADMIN' })
      .expect(409);
    expect(tx.staffAuditEvent.create).not.toHaveBeenCalled();
  });
  it('removes only the selected shop membership and audits the removal', async () => {
    tx.shopMember.findFirst.mockResolvedValue({
      userId,
      role: 'CASHIER',
      user: { email: invite.email },
    });
    await owner()
      .delete(`/api/v1/shops/${shopId}/staff/members/${resourceId}`)
      .set('Authorization', 'Bearer owner')
      .expect(204);
    expect(tx.shopMember.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: resourceId,
        shopId,
        role: 'CASHIER',
      }),
    });
    expect(tx.staffAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'REMOVED',
        shopId,
        targetUserId: userId,
      }),
    });
  });
  it('revokes an unaccepted invitation', async () => {
    await owner()
      .delete(`/api/v1/shops/${shopId}/staff/invitations/${resourceId}`)
      .set('Authorization', 'Bearer owner')
      .expect(204);
    expect(tx.staffInvitation.updateMany).toHaveBeenCalledWith({
      where: { id: resourceId, shopId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it.each([false, true])(
    'sets shop membership access to %s and audits it without deleting membership',
    async (isEnabled) => {
      const disabledAt = isEnabled ? new Date('2026-10-10') : null;
      tx.shopMember.findFirst.mockResolvedValue({
        userId,
        role: 'CASHIER',
        disabledAt,
        user: { email: invite.email },
      });
      await owner()
        .patch(`/api/v1/shops/${shopId}/staff/members/${resourceId}/access`)
        .set('Authorization', 'Bearer owner')
        .send({ isEnabled })
        .expect(204);
      expect(tx.shopMember.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: resourceId,
          shopId,
          role: 'CASHIER',
          disabledAt,
        }),
        data: { disabledAt: isEnabled ? null : expect.any(Date) },
      });
      expect(tx.staffAuditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId,
          actorId: ownerId,
          targetUserId: userId,
          role: 'CASHIER',
          action: isEnabled ? 'ENABLED' : 'DISABLED',
        }),
      });
      expect(tx.shopMember.deleteMany).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'protects OWNER membership from an access change (%s)',
    async (isEnabled) => {
      tx.shopMember.findFirst.mockResolvedValue({
        userId: ownerId,
        role: 'OWNER',
        disabledAt: null,
        user: { email: 'owner@example.com' },
      });
      const response = await owner()
        .patch(`/api/v1/shops/${shopId}/staff/members/${resourceId}/access`)
        .set('Authorization', 'Bearer owner')
        .send({ isEnabled })
        .expect(403);
      expect(response.body.code).toBe('OWNER_PROTECTED');
      expect(tx.shopMember.updateMany).not.toHaveBeenCalled();
      expect(tx.staffAuditEvent.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    { isEnabled: 'false' },
    { isEnabled: 0 },
    {},
    { isEnabled: false, isActive: false },
  ])('rejects invalid access payload %j', async (body) => {
    await owner()
      .patch(`/api/v1/shops/${shopId}/staff/members/${resourceId}/access`)
      .set('Authorization', 'Bearer owner')
      .send(body)
      .expect(400);
    expect(tx.shopMember.updateMany).not.toHaveBeenCalled();
  });

  it('does not audit a repeated access setting', async () => {
    tx.shopMember.findFirst.mockResolvedValue({
      userId,
      role: 'CASHIER',
      disabledAt: null,
      user: { email: invite.email },
    });
    await owner()
      .patch(`/api/v1/shops/${shopId}/staff/members/${resourceId}/access`)
      .set('Authorization', 'Bearer owner')
      .send({ isEnabled: true })
      .expect(204);
    expect(tx.shopMember.updateMany).not.toHaveBeenCalled();
    expect(tx.staffAuditEvent.create).not.toHaveBeenCalled();
  });

  it('denies membership access changes if the owner lost live access after the guard', async () => {
    tx.shop.findFirst.mockResolvedValue(null);
    await owner()
      .patch(`/api/v1/shops/${shopId}/staff/members/${resourceId}/access`)
      .set('Authorization', 'Bearer owner')
      .send({ isEnabled: false })
      .expect(403);
    expect(tx.shopMember.updateMany).not.toHaveBeenCalled();
  });

  it('does not audit a conflicting access change', async () => {
    tx.shopMember.findFirst.mockResolvedValue({
      userId,
      role: 'CASHIER',
      disabledAt: null,
      user: { email: invite.email },
    });
    tx.shopMember.updateMany.mockResolvedValue({ count: 0 });
    await owner()
      .patch(`/api/v1/shops/${shopId}/staff/members/${resourceId}/access`)
      .set('Authorization', 'Bearer owner')
      .send({ isEnabled: false })
      .expect(409);
    expect(tx.staffAuditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects access changes targeting another shop membership', async () => {
    tx.shopMember.findFirst.mockResolvedValue(null);
    await owner()
      .patch(`/api/v1/shops/${shopId}/staff/members/${resourceId}/access`)
      .set('Authorization', 'Bearer owner')
      .send({ isEnabled: false })
      .expect(404);
    expect(tx.shopMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: resourceId, shopId } }),
    );
    expect(tx.shopMember.updateMany).not.toHaveBeenCalled();
  });

  it('distinguishes account activity from membership access in the staff list', async () => {
    tx.shopMember.findMany.mockResolvedValue([
      {
        id: resourceId,
        userId,
        role: 'CASHIER',
        disabledAt: new Date(),
        user: { email: invite.email, isActive: true },
      },
    ]);
    const response = await owner()
      .get(`/api/v1/shops/${shopId}/staff`)
      .set('Authorization', 'Bearer owner')
      .expect(200);
    expect(response.body.members[0]).toMatchObject({
      isEnabled: false,
      isActive: true,
      role: 'CASHIER',
    });
  });

  it.each(['preview', 'accept'])(
    'rate limits repeated %s attempts before another transaction',
    async (action) => {
      const attempt = () =>
        owner()
          .post(`/api/v1/staff-invitations/${shopId}/${action}`)
          .set('Authorization', 'Bearer invitee')
          .send({ token: 'b'.repeat(64) });
      for (let index = 0; index < 30; index++) await attempt().expect(404);
      const calls = transaction.mock.calls.length;
      const response = await attempt().expect(429);
      expect(response.headers['retry-after']).toBeDefined();
      expect(transaction).toHaveBeenCalledTimes(calls);
      expect(tx.shopMember.create).not.toHaveBeenCalled();
    },
  );

  it('rate limits invitation creation without writing another invitation', async () => {
    const attempt = () =>
      owner()
        .post(`/api/v1/shops/${shopId}/staff/invitations`)
        .set('Authorization', 'Bearer owner')
        .send({ email: 'cashier@example.com', role: 'CASHIER' });
    for (let index = 0; index < 10; index++) await attempt().expect(201);
    await attempt().expect(429);
    expect(tx.staffInvitation.create).toHaveBeenCalledTimes(10);
  });

  const inboxDecision = (action: string, auth = true) => {
    const req = owner().post(
      `/api/v1/account/notifications/invitations/${shopId}/${resourceId}/${action}`,
    );
    return auth ? req.set('Authorization', 'Bearer invitee') : req;
  };
  it.each(['accept', 'decline'])(
    'requires authentication for inbox %s',
    async (action) => {
      await inboxDecision(action, false).expect(401);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('accepts an inbox invitation using live identity, without a membership or exposed token', async () => {
    role = 'CASHIER';
    const result = await inboxDecision('accept').expect(200);
    expect(result.body).toEqual({ shopId, role: 'CASHIER' });
    expect(tx.staffInvitation.findFirst).toHaveBeenCalledWith({
      where: { shopId, id: resourceId },
    });
    expect(tx.shopMember.create).toHaveBeenCalledWith({
      data: { shopId, userId, role: 'CASHIER' },
    });
  });
  it('declines atomically without creating a membership and records the result', async () => {
    await inboxDecision('decline').expect(204);
    expect(tx.shopMember.create).not.toHaveBeenCalled();
    expect(tx.staffInvitation.updateMany.mock.calls[0][0].data).toMatchObject({
      declinedAt: expect.any(Date),
      revokedAt: expect.any(Date),
    });
    expect(tx.staffAuditEvent.create.mock.calls[0][0].data).toMatchObject({
      action: 'DECLINED',
      invitationId: resourceId,
      actorId: userId,
    });
  });
  it.each(['accept', 'decline'])(
    'hides inbox %s from the wrong email',
    async (action) => {
      tx.user.findFirst.mockResolvedValue({
        email: 'someone-else@example.com',
      });
      await inboxDecision(action).expect(404);
      expect(tx.staffInvitation.updateMany).not.toHaveBeenCalled();
    },
  );
  it.each(['accept', 'decline'])(
    'rechecks issuer authority for inbox %s',
    async (action) => {
      tx.shop.findFirst.mockResolvedValue(null);
      await inboxDecision(action).expect(404);
      expect(tx.staffInvitation.updateMany).not.toHaveBeenCalled();
    },
  );
  it.each(['accept', 'decline'])(
    'rejects revoked and consumed inbox %s',
    async (action) => {
      invite.revokedAt = new Date();
      await inboxDecision(action).expect(404);
      expect(tx.shopMember.create).not.toHaveBeenCalled();
    },
  );
});
