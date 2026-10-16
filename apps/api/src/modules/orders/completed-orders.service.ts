import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type {
  CompletedOrderSummary,
  CompletedOrdersResponse,
} from '@paserve/contracts';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';
import { ownerOrderSearchWhere } from './owner-order-search.js';

@Injectable()
export class CompletedOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: ShopMembersService,
  ) {}

  async list(
    actorId: string,
    shopId: string,
    cursor?: unknown,
    search?: unknown,
  ): Promise<CompletedOrdersResponse> {
    const access = shopAccessWhere(actorId, shopId, ['OWNER']);
    const searchWhere = ownerOrderSearchWhere(search);
    let after: { completedAt: Date; id: string } | undefined;
    if (cursor !== undefined) {
      try {
        if (
          typeof cursor !== 'string' ||
          !/^[A-Za-z0-9_-]{1,200}$/.test(cursor)
        )
          throw new Error();
        const decoded = Buffer.from(cursor, 'base64url');
        if (decoded.toString('base64url') !== cursor) throw new Error();
        const values: unknown = JSON.parse(decoded.toString('utf8'));
        if (
          !Array.isArray(values) ||
          values.length !== 2 ||
          typeof values[0] !== 'string' ||
          typeof values[1] !== 'string' ||
          !isUUID(values[1]) ||
          new Date(values[0]).toISOString() !== values[0]
        )
          throw new Error();
        after = { completedAt: new Date(values[0]), id: values[1] };
      } catch {
        throw new BadRequestException({
          code: 'INVALID_COMPLETED_ORDERS_CURSOR',
          message: 'Refresh completed orders to start again.',
        });
      }
    }
    await this.members.requireOwner(actorId, shopId);
    const saved = await this.prisma.order.findMany({
      where: {
        shopId,
        shop: access,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: 'COMPLETED',
        completedAt: { not: null },
        completedBy: { not: null },
        currency: 'PHP',
        ...(searchWhere ? { AND: [searchWhere] } : {}),
        ...(after
          ? {
              OR: [
                { completedAt: { lt: after.completedAt } },
                { completedAt: after.completedAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      take: 26,
      select: {
        id: true,
        shopId: true,
        orderNumber: true,
        mode: true,
        tableNumber: true,
        status: true,
        paymentStatus: true,
        preparationStatus: true,
        paymentMethod: true,
        currency: true,
        totalPrice: true,
        createdAt: true,
        paidAt: true,
        completedAt: true,
      },
    });
    const orders = saved.slice(0, 25).map((order): CompletedOrderSummary => {
      const method = order.paymentMethod;
      if (
        !order.completedAt ||
        !order.paidAt ||
        order.paidAt < order.createdAt ||
        order.completedAt < order.paidAt ||
        (method !== 'CASH' &&
          method !== 'GCASH_MANUAL' &&
          method !== 'CARD_MANUAL' &&
          method !== 'OTHER')
      ) {
        throw new ConflictException({
          code: 'COMPLETED_ORDER_UNAVAILABLE',
          message: 'The saved completed order could not be loaded.',
        });
      }
      return {
        ...order,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: 'COMPLETED',
        paymentMethod: method,
        currency: 'PHP',
        totalPrice: order.totalPrice.toFixed(2),
        createdAt: order.createdAt.toISOString(),
        paidAt: order.paidAt.toISOString(),
        completedAt: order.completedAt.toISOString(),
      };
    });
    const last = orders.at(-1);
    return {
      orders,
      nextCursor:
        saved.length > 25 && last
          ? Buffer.from(JSON.stringify([last.completedAt, last.id])).toString(
              'base64url',
            )
          : null,
    };
  }
}
