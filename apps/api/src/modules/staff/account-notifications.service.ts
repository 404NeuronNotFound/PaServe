import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type {
  AccountNotificationsResponse,
  AccountNotificationKind,
  StaffInvitation,
} from '@paserve/contracts';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class AccountNotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async recipient(
    userId: string,
  ): Promise<Prisma.AccountNotificationWhereInput> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: { email: true },
    });
    if (!user) throw new NotFoundException('Account unavailable.');
    return {
      OR: [
        { recipientUserId: userId },
        { recipientUserId: null, recipientEmail: user.email },
      ],
    };
  }

  async list(
    userId: string,
    cursor?: string,
  ): Promise<AccountNotificationsResponse> {
    const recipient = await this.recipient(userId);
    let before: Prisma.AccountNotificationWhereInput = {};
    if (cursor) {
      if (!isUUID(cursor))
        throw new BadRequestException('Invalid notification cursor.');
      const last = await this.prisma.accountNotification.findFirst({
        where: { AND: [recipient, { id: cursor }] },
      });
      if (!last) throw new NotFoundException('Notification unavailable.');
      before = {
        OR: [
          { createdAt: { lt: last.createdAt } },
          { createdAt: last.createdAt, id: { lt: last.id } },
        ],
      };
    }
    const [rows, unreadCount] = await Promise.all([
      this.prisma.accountNotification.findMany({
        where: { AND: [recipient, before] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 31,
      }),
      this.prisma.accountNotification.count({
        where: { AND: [recipient, { readAt: null }] },
      }),
    ]);
    const page = rows.slice(0, 30);
    const invites = await this.prisma.staffInvitation.findMany({
      where: {
        OR: page
          .filter((n) => n.kind === 'INVITED' && n.invitationId)
          .map((n) => ({
            id: n.invitationId!,
            shopId: n.shopId,
            email: n.recipientEmail,
          })),
      },
      include: {
        shop: {
          select: {
            isActive: true,
            members: {
              where: {
                role: 'OWNER',
                disabledAt: null,
                user: { isActive: true },
              },
              select: { userId: true },
            },
          },
        },
      },
    });
    return {
      unreadCount,
      nextCursor: rows.length > 30 ? page[29].id : null,
      notifications: page.map((n) => {
        const invite = invites.find(
          (i) => i.id === n.invitationId && i.shopId === n.shopId,
        );
        let invitation: AccountNotificationsResponse['notifications'][number]['invitation'] =
          null;
        if (n.kind === 'INVITED') {
          let status: StaffInvitation['status'] = 'REVOKED';
          if (invite)
            status = invite.declinedAt
              ? 'DECLINED'
              : invite.acceptedAt
                ? 'ACCEPTED'
                : invite.revokedAt
                  ? 'REVOKED'
                  : invite.expiresAt <= new Date()
                    ? 'EXPIRED'
                    : !invite.shop.isActive ||
                        !invite.shop.members.some(
                          (m) => m.userId === invite.invitedBy,
                        )
                      ? 'REVOKED'
                      : 'PENDING';
          invitation = {
            id: n.invitationId!,
            status,
            expiresAt: (invite?.expiresAt ?? n.createdAt).toISOString(),
          };
        }
        return {
          id: n.id,
          kind: n.kind as AccountNotificationKind,
          shopId: n.shopId,
          shopName: n.shopName,
          actorName: n.actorName,
          role: n.role,
          previousRole: n.previousRole,
          createdAt: n.createdAt.toISOString(),
          readAt: n.readAt?.toISOString() ?? null,
          invitation,
        };
      }),
    };
  }

  async markRead(userId: string, id?: string) {
    if (id && !isUUID(id))
      throw new BadRequestException('Invalid notification identifier.');
    const recipient = await this.recipient(userId);
    // Repeat recipient scope on writes: IDs never grant inbox access.
    const result = await this.prisma.accountNotification.updateMany({
      where: { AND: [recipient, { ...(id ? { id } : {}), readAt: null }] },
      data: { readAt: new Date() },
    });
    if (
      id &&
      !result.count &&
      !(await this.prisma.accountNotification.findFirst({
        where: { AND: [recipient, { id }] },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException('Notification unavailable.');
    }
  }
}
