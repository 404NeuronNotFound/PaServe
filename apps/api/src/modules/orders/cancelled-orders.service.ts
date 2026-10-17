import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type {
  CancelledOrderSummary,
  CancelledOrdersResponse,
} from '@paserve/contracts';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { shopPermissionWhere } from '../tenancy/shop-scope.js';
import { ownerOrderSearchWhere } from './owner-order-search.js';
import { ownerOrderFiltersWhere } from './owner-order-filters.js';

@Injectable()
export class CancelledOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: ShopMembersService,
  ) {}

  async list(
    actorId: string,
    shopId: string,
    cursor?: unknown,
    search?: unknown,
    filters?: unknown,
  ): Promise<CancelledOrdersResponse> {
    const access = shopPermissionWhere(
      actorId,
      shopId,
      'shop.orders.overview.read',
    );
    const searchWhere = ownerOrderSearchWhere(search);
    const filtersWhere = ownerOrderFiltersWhere(filters, 'cancelled');
    let after: { createdAt: Date; id: string } | undefined;
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
        after = { createdAt: new Date(values[0]), id: values[1] };
      } catch {
        throw new BadRequestException({
          code: 'INVALID_CANCELLED_ORDERS_CURSOR',
          message: 'Refresh cancelled / rejected orders to start again.',
        });
      }
    }
    await this.members.requireOwner(actorId, shopId);
    const saved = await this.prisma.order.findMany({
      where: {
        shopId,
        shop: access,
        status: 'REJECTED',
        paymentStatus: 'UNPAID',
        preparationStatus: null,
        completedAt: null,
        currency: 'PHP',
        ...(searchWhere || filtersWhere
          ? {
              AND: [
                ...(searchWhere ? [searchWhere] : []),
                ...(filtersWhere ? [filtersWhere] : []),
              ],
            }
          : {}),
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
        currency: true,
        totalPrice: true,
        createdAt: true,
        decidedAt: true,
        decidedBy: true,
        rejectionReason: true,
      },
    });
    const orders = saved.slice(0, 25).map((order): CancelledOrderSummary => {
      if (
        (order.decidedAt && order.decidedAt < order.createdAt) ||
        (order.rejectionReason && order.rejectionReason.length > 300)
      ) {
        throw new ConflictException({
          code: 'CANCELLED_ORDER_UNAVAILABLE',
          message: 'The saved rejected order could not be loaded.',
        });
      }
      return {
        ...order,
        status: 'REJECTED',
        paymentStatus: 'UNPAID',
        preparationStatus: null,
        currency: 'PHP',
        totalPrice: order.totalPrice.toFixed(2),
        createdAt: order.createdAt.toISOString(),
        decidedAt: order.decidedAt?.toISOString() ?? null,
        decidedBy: order.decidedBy?.trim() || null,
        rejectionReason: order.rejectionReason?.trim() || null,
      };
    });
    const last = orders.at(-1);
    return {
      orders,
      nextCursor:
        saved.length > 25 && last
          ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString(
              'base64url',
            )
          : null,
    };
  }
}
