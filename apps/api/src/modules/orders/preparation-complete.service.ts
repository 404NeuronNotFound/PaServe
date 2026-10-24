import { rolesForShopPermissions } from '@paserve/contracts';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type CompletePreparationResponse } from '@paserve/contracts';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';

export const PREPARATION_COMPLETE_ROLES = rolesForShopPermissions(
  'shop.preparation.status.update',
);
const changed = () =>
  new ConflictException({
    code: 'ORDER_NOT_READY',
    message:
      'This order is not ready for completion. Refresh the kitchen workspace.',
  });

@Injectable()
export class PreparationCompleteService {
  constructor(private readonly prisma: PrismaService) {}
  async complete(
    actorId: string,
    shopId: string,
    orderId: string,
  ): Promise<CompletePreparationResponse> {
    if (!isUUID(orderId))
      throw new BadRequestException({
        code: 'INVALID_ORDER_ID',
        message: 'A valid order ID is required.',
      });
    const access = shopAccessWhere(actorId, shopId, PREPARATION_COMPLETE_ROLES);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE`;
          await tx.$queryRaw`SELECT m.id FROM shop_members m JOIN users u ON u.id = m."userId"
          WHERE m."shopId" = ${shopId} AND m."userId" = ${actorId} FOR UPDATE OF m, u`;
          await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} AND "shopId" = ${shopId} FOR UPDATE`;
          const current = await tx.order.findFirst({
            where: { id: orderId, shopId, shop: access },
            select: {
              status: true,
              paymentStatus: true,
              preparationStatus: true,
              queuedAt: true,
              preparationStartedAt: true,
              preparationStartedBy: true,
              preparationReadyAt: true,
              preparationReadyBy: true,
              completedAt: true,
              completedBy: true,
            },
          });
          if (!current)
            throw new NotFoundException({
              code: 'ORDER_NOT_ACCESSIBLE',
              message: 'This order is unavailable in this shop.',
            });
          if (
            current.status !== 'CONFIRMED' ||
            current.paymentStatus !== 'PAID' ||
            !current.queuedAt ||
            !current.preparationStartedAt ||
            !current.preparationStartedBy ||
            !current.preparationReadyAt ||
            !current.preparationReadyBy ||
            current.preparationStartedAt < current.queuedAt ||
            current.preparationReadyAt < current.preparationStartedAt
          )
            throw changed();
          const base = {
            id: orderId,
            shopId,
            preparationStatus: 'COMPLETED' as const,
            queuedAt: current.queuedAt.toISOString(),
            preparationStartedAt: current.preparationStartedAt.toISOString(),
            preparationStartedBy: current.preparationStartedBy,
            preparationReadyAt: current.preparationReadyAt.toISOString(),
            preparationReadyBy: current.preparationReadyBy,
          };
          if (
            current.preparationStatus === 'COMPLETED' &&
            current.completedAt &&
            current.completedBy &&
            current.completedAt >= current.preparationReadyAt
          )
            return {
              order: {
                ...base,
                completedAt: current.completedAt.toISOString(),
                completedBy: current.completedBy,
              },
              alreadyCompleted: true,
            };
          if (
            current.preparationStatus !== 'READY' ||
            current.completedAt ||
            current.completedBy
          )
            throw changed();
          const [clock] = await tx.$queryRaw<
            Array<{ now: Date }>
          >`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now`;
          const completedAt = new Date(
            Math.max(clock.now.getTime(), current.preparationReadyAt.getTime()),
          );
          const result = await tx.order.updateMany({
            where: {
              id: orderId,
              shopId,
              shop: access,
              status: 'CONFIRMED',
              paymentStatus: 'PAID',
              preparationStatus: 'READY',
              queuedAt: current.queuedAt,
              preparationStartedAt: current.preparationStartedAt,
              preparationStartedBy: current.preparationStartedBy,
              preparationReadyAt: current.preparationReadyAt,
              preparationReadyBy: current.preparationReadyBy,
              completedAt: null,
              completedBy: null,
            },
            data: {
              preparationStatus: 'COMPLETED',
              completedAt,
              completedBy: actorId,
              updatedAt: completedAt,
            },
          });
          if (result.count !== 1) throw changed();
          return {
            order: {
              ...base,
              completedAt: completedAt.toISOString(),
              completedBy: actorId,
            },
            alreadyCompleted: false,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: 15_000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002'].includes(error.code)
      )
        throw changed();
      throw error;
    }
  }
}
