import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { isUUID } from 'class-validator';
import {
  STAFF_ROLES,
  type StaffInvitation as InvitationResponse,
  type StaffRole,
  type ShopStaffResponse,
} from '@paserve/contracts';
import { Prisma, type StaffInvitation } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { shopPermissionWhere } from '../tenancy/shop-scope.js';
import type {
  InviteStaffDto,
  StaffRoleDto,
  StaffAccessDto,
} from './staff.dto.js';

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const invalidInvitation = () =>
  new NotFoundException({
    code: 'INVITATION_UNAVAILABLE',
    message: 'This invitation is unavailable, expired, or no longer valid.',
  });
const changed = () =>
  new ConflictException({
    code: 'STAFF_CHANGED',
    message: 'Staff access changed. Refresh and try again.',
  });
function invitationResponse(invite: StaffInvitation): InvitationResponse {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role as StaffRole,
    expiresAt: invite.expiresAt.toISOString(),
    status: invite.declinedAt
      ? 'DECLINED'
      : invite.acceptedAt
        ? 'ACCEPTED'
        : invite.revokedAt
          ? 'REVOKED'
          : invite.expiresAt <= new Date()
            ? 'EXPIRED'
            : 'PENDING',
  };
}

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  private id(value: string) {
    if (!isUUID(value))
      throw new BadRequestException({
        code: 'INVALID_RESOURCE_ID',
        message: 'A valid identifier is required.',
      });
  }

  private staffRole(role: StaffRole) {
    if (!STAFF_ROLES.includes(role))
      throw new BadRequestException({
        code: 'INVALID_STAFF_ROLE',
        message:
          'Choose an admin, manager, cashier, or kitchen role. Ownership cannot be assigned through staff management.',
      });
  }

  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30_000,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          const cause = (
            error.meta?.driverAdapterError as
              { cause?: { originalCode?: string } } | undefined
          )?.cause;
          const retryable =
            error.code === 'P2034' ||
            (error.code === 'P2010' &&
              [error.meta?.code, cause?.originalCode].some((state) =>
                ['40001', '40P01'].includes(String(state)),
              ));
          if (retryable && attempt < 2) continue;
          if (retryable || error.code === 'P2002') throw changed();
        }
        throw error;
      }
    }
    throw changed();
  }

  private async lockShop(tx: Prisma.TransactionClient, shopId: string) {
    this.id(shopId);
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM shops WHERE id = ${shopId} AND "isActive" = true FOR UPDATE`;
    if (!rows.length)
      throw new NotFoundException({
        code: 'SHOP_NOT_ACCESSIBLE',
        message: 'This shop is unavailable.',
      });
  }

  private async owner(
    tx: Prisma.TransactionClient,
    actorId: string,
    shopId: string,
  ) {
    await this.lockShop(tx, shopId);
    // Hold the actor membership and account through commit, then reread live
    // owner access. All staff writers lock the shop first, including acceptance.
    await tx.$queryRaw`
      SELECT m.id FROM shop_members m JOIN users u ON u.id = m."userId"
      WHERE m."shopId" = ${shopId} AND m."userId" = ${actorId} FOR UPDATE OF m, u`;
    if (
      !(await tx.shop.findFirst({
        where: shopPermissionWhere(actorId, shopId, 'shop.staff.manage'),
        select: { id: true },
      }))
    )
      throw new ForbiddenException({
        code: 'OWNER_REQUIRED',
        message: 'Only the current shop owner can manage staff.',
      });
  }

  async list(actorId: string, shopId: string): Promise<ShopStaffResponse> {
    return this.transaction(async (tx) => {
      await this.owner(tx, actorId, shopId);
      const members = await tx.shopMember.findMany({
        where: {
          shopId,
          shop: shopPermissionWhere(actorId, shopId, 'shop.staff.manage'),
        },
        select: {
          id: true,
          userId: true,
          role: true,
          disabledAt: true,
          user: { select: { email: true, isActive: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      const invitations = await tx.staffInvitation.findMany({
        where: {
          shopId,
          shop: shopPermissionWhere(actorId, shopId, 'shop.staff.manage'),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return {
        shopId,
        members: members.map(({ user, disabledAt, ...member }) => ({
          ...member,
          ...user,
          isEnabled: disabledAt == null,
        })),
        invitations: invitations.map(invitationResponse),
      };
    });
  }

  async invite(actorId: string, shopId: string, dto: InviteStaffDto) {
    this.staffRole(dto.role);
    const token = randomBytes(32).toString('hex');
    return this.transaction(async (tx) => {
      await this.owner(tx, actorId, shopId);
      if (
        await tx.shopMember.findFirst({
          where: { shopId, user: { email: dto.email } },
          select: { id: true },
        })
      )
        throw new ConflictException({
          code: 'ALREADY_SHOP_MEMBER',
          message:
            'This account already belongs to the shop. Change its role from the staff list.',
        });
      const pending = await tx.staffInvitation.findMany({
        where: { shopId, email: dto.email, acceptedAt: null, revokedAt: null },
        select: { id: true, role: true },
      });
      // A new link replaces all older unaccepted links for this email/shop.
      await tx.staffInvitation.updateMany({
        where: { shopId, email: dto.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      for (const prior of pending)
        await tx.staffAuditEvent.create({
          data: {
            shopId,
            actorId,
            action: 'REVOKED',
            targetEmail: dto.email,
            invitationId: prior.id,
            role: prior.role,
          },
        });
      const invite = await tx.staffInvitation.create({
        data: {
          shopId,
          email: dto.email,
          role: dto.role,
          tokenHash: hash(token),
          invitedBy: actorId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      await tx.staffAuditEvent.create({
        data: {
          shopId,
          actorId,
          action: 'INVITED',
          targetEmail: dto.email,
          invitationId: invite.id,
          role: dto.role,
        },
      });
      return { shopId, invitation: invitationResponse(invite), token };
    });
  }

  async revoke(actorId: string, shopId: string, invitationId: string) {
    this.id(invitationId);
    return this.transaction(async (tx) => {
      await this.owner(tx, actorId, shopId);
      const invite = await tx.staffInvitation.findFirst({
        where: { id: invitationId, shopId },
      });
      if (!invite) throw invalidInvitation();
      if (invite.acceptedAt) throw changed();
      if (invite.revokedAt) return;
      const result = await tx.staffInvitation.updateMany({
        where: { id: invitationId, shopId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count !== 1) throw changed();
      await tx.staffAuditEvent.create({
        data: {
          shopId,
          actorId,
          action: 'REVOKED',
          targetEmail: invite.email,
          invitationId,
          role: invite.role,
        },
      });
    });
  }

  async changeRole(
    actorId: string,
    shopId: string,
    memberId: string,
    dto: StaffRoleDto,
  ) {
    this.id(memberId);
    return this.transaction(async (tx) => {
      await this.owner(tx, actorId, shopId);
      const member = await tx.shopMember.findFirst({
        where: { id: memberId, shopId },
        include: { user: { select: { email: true } } },
      });
      if (!member)
        throw new NotFoundException({
          code: 'MEMBER_UNAVAILABLE',
          message: 'This staff member is unavailable.',
        });
      if (member.role === 'OWNER' || member.userId === actorId)
        throw new ForbiddenException({
          code: 'OWNER_PROTECTED',
          message:
            'Owner membership is protected and cannot be changed through staff management.',
        });
      this.staffRole(dto.role);
      if (member.role === dto.role) return;
      const result = await tx.shopMember.updateMany({
        where: {
          id: memberId,
          shopId,
          role: member.role,
          shop: shopPermissionWhere(actorId, shopId, 'shop.staff.manage'),
        },
        data: { role: dto.role },
      });
      if (result.count !== 1) throw changed();
      await tx.staffAuditEvent.create({
        data: {
          shopId,
          actorId,
          action: 'ROLE_CHANGED',
          targetEmail: member.user.email,
          targetUserId: member.userId,
          previousRole: member.role,
          role: dto.role,
        },
      });
    });
  }

  async setAccess(
    actorId: string,
    shopId: string,
    memberId: string,
    dto: StaffAccessDto,
  ) {
    this.id(memberId);
    if (typeof dto.isEnabled !== 'boolean')
      throw new BadRequestException({
        code: 'INVALID_STAFF_ACCESS',
        message: 'Choose whether shop access is enabled.',
      });
    return this.transaction(async (tx) => {
      await this.owner(tx, actorId, shopId);
      const member = await tx.shopMember.findFirst({
        where: { id: memberId, shopId },
        include: { user: { select: { email: true } } },
      });
      if (!member)
        throw new NotFoundException({
          code: 'MEMBER_UNAVAILABLE',
          message: 'This staff member is unavailable.',
        });
      if (member.role === 'OWNER' || member.userId === actorId)
        throw new ForbiddenException({
          code: 'OWNER_PROTECTED',
          message:
            'Owner membership cannot be suspended through staff management.',
        });
      if ((member.disabledAt == null) === dto.isEnabled) return;
      const result = await tx.shopMember.updateMany({
        where: {
          id: memberId,
          shopId,
          role: member.role,
          disabledAt: member.disabledAt ?? null,
          shop: shopPermissionWhere(actorId, shopId, 'shop.staff.manage'),
        },
        data: { disabledAt: dto.isEnabled ? null : new Date() },
      });
      if (result.count !== 1) throw changed();
      await tx.staffAuditEvent.create({
        data: {
          shopId,
          actorId,
          action: dto.isEnabled ? 'ENABLED' : 'DISABLED',
          targetEmail: member.user.email,
          targetUserId: member.userId,
          role: member.role,
        },
      });
    });
  }

  async remove(actorId: string, shopId: string, memberId: string) {
    this.id(memberId);
    return this.transaction(async (tx) => {
      await this.owner(tx, actorId, shopId);
      const member = await tx.shopMember.findFirst({
        where: { id: memberId, shopId },
        include: { user: { select: { email: true } } },
      });
      if (!member)
        throw new NotFoundException({
          code: 'MEMBER_UNAVAILABLE',
          message: 'This staff member is unavailable.',
        });
      if (member.role === 'OWNER' || member.userId === actorId)
        throw new ForbiddenException({
          code: 'OWNER_PROTECTED',
          message:
            'Owner membership is protected and cannot be removed through staff management.',
        });
      const result = await tx.shopMember.deleteMany({
        where: {
          id: memberId,
          shopId,
          role: member.role,
          shop: shopPermissionWhere(actorId, shopId, 'shop.staff.manage'),
        },
      });
      if (result.count !== 1) throw changed();
      await tx.staffAuditEvent.create({
        data: {
          shopId,
          actorId,
          action: 'REMOVED',
          targetEmail: member.user.email,
          targetUserId: member.userId,
          previousRole: member.role,
        },
      });
    });
  }

  private async resolveInvitation(
    tx: Prisma.TransactionClient,
    actorId: string,
    shopId: string,
    token: string,
    fromInbox = false,
  ) {
    await this.lockShop(tx, shopId);
    const invite = await tx.staffInvitation.findFirst({
      where: {
        shopId,
        ...(fromInbox ? { id: token } : { tokenHash: hash(token) }),
      },
    });
    if (
      !invite ||
      invite.revokedAt ||
      invite.acceptedAt ||
      invite.expiresAt <= new Date() ||
      !STAFF_ROLES.includes(invite.role as StaffRole)
    )
      throw invalidInvitation();
    await tx.$queryRaw`
        SELECT m.id FROM shop_members m JOIN users u ON u.id = m."userId"
        WHERE m."shopId" = ${shopId} AND m."userId" = ${invite.invitedBy} FOR UPDATE OF m, u`;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`;
    const user = await tx.user.findFirst({
      where: { id: actorId, isActive: true },
      select: { email: true },
    });
    if ((!user || user.email !== invite.email) && fromInbox)
      throw invalidInvitation();
    if (!user || user.email !== invite.email)
      throw new ForbiddenException({
        code: 'INVITATION_EMAIL_MISMATCH',
        message:
          'Sign in with the email address this invitation was issued to.',
      });
    const existing = await tx.shopMember.findFirst({
      where: { userId: actorId, shopId },
      select: { role: true },
    });
    return { invite, user, existing };
  }

  async preview(actorId: string, shopId: string, token: string) {
    return this.transaction(async (tx) => {
      const { invite, user, existing } = await this.resolveInvitation(
        tx,
        actorId,
        shopId,
        token,
      );
      if (existing) throw invalidInvitation();
      const shop = await tx.shop.findFirst({
        where: shopPermissionWhere(
          invite.invitedBy,
          shopId,
          'shop.staff.manage',
        ),
        select: { id: true, name: true },
      });
      if (!shop) throw invalidInvitation();
      return {
        shopId,
        shopName: shop.name,
        email: user.email,
        role: invite.role as StaffRole,
        expiresAt: invite.expiresAt.toISOString(),
      };
    });
  }

  async accept(
    actorId: string,
    shopId: string,
    token: string,
    fromInbox = false,
  ) {
    if (fromInbox) this.id(token);
    return this.transaction(async (tx) => {
      const { invite, user, existing } = await this.resolveInvitation(
        tx,
        actorId,
        shopId,
        token,
        fromInbox,
      );
      if (
        !(await tx.shop.findFirst({
          where: shopPermissionWhere(
            invite.invitedBy,
            shopId,
            'shop.staff.manage',
          ),
          select: { id: true },
        }))
      )
        throw invalidInvitation();
      if (existing)
        throw new ConflictException({
          code: 'ALREADY_SHOP_MEMBER',
          message:
            'You already belong to this shop. Ask its owner to review your role.',
        });
      const now = new Date();
      const result = await tx.staffInvitation.updateMany({
        where: {
          id: invite.id,
          shopId,
          tokenHash: invite.tokenHash,
          revokedAt: null,
          acceptedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now, acceptedBy: actorId },
      });
      if (result.count !== 1) throw invalidInvitation();
      await tx.shopMember.create({
        data: { shopId, userId: actorId, role: invite.role },
      });
      await tx.staffAuditEvent.create({
        data: {
          shopId,
          actorId,
          action: 'ACCEPTED',
          targetEmail: user.email,
          targetUserId: actorId,
          invitationId: invite.id,
          role: invite.role,
        },
      });
      return { shopId, role: invite.role as StaffRole };
    });
  }

  async decline(actorId: string, shopId: string, invitationId: string) {
    this.id(invitationId);
    return this.transaction(async (tx) => {
      const { invite, user, existing } = await this.resolveInvitation(
        tx,
        actorId,
        shopId,
        invitationId,
        true,
      );
      if (
        existing ||
        !(await tx.shop.findFirst({
          where: shopPermissionWhere(
            invite.invitedBy,
            shopId,
            'shop.staff.manage',
          ),
          select: { id: true },
        }))
      )
        throw invalidInvitation();
      const now = new Date();
      const result = await tx.staffInvitation.updateMany({
        where: {
          id: invite.id,
          shopId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { declinedAt: now, revokedAt: now },
      });
      if (result.count !== 1) throw invalidInvitation();
      await tx.staffAuditEvent.create({
        data: {
          shopId,
          actorId,
          action: 'DECLINED',
          targetEmail: user.email,
          targetUserId: actorId,
          invitationId: invite.id,
          role: invite.role,
        },
      });
    });
  }
}
