import { BadRequestException, Injectable } from '@nestjs/common';
import type { ActiveOrdersResponse } from '@paserve/contracts';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { shopPermissionWhere } from '../tenancy/shop-scope.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { ownerOrderSearchWhere } from './owner-order-search.js';
import { ownerOrderFiltersWhere } from './owner-order-filters.js';

@Injectable()
export class ActiveOrdersService {
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
  ): Promise<ActiveOrdersResponse> {
    const access = shopPermissionWhere(
      actorId,
      shopId,
      'shop.orders.overview.read',
    );
    const searchWhere = ownerOrderSearchWhere(search);
    const filtersWhere = ownerOrderFiltersWhere(filters, 'active');
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
          code: 'INVALID_ACTIVE_ORDERS_CURSOR',
          message: 'Refresh active orders to start again.',
        });
      }
    }
    // Repeat live authorization even for empty lists, then scope the read itself.
    await this.members.requireOwner(actorId, shopId);
    const saved = await this.prisma.order.findMany({
      where: {
        shopId,
        shop: access,
        status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED'] },
        completedAt: null,
        AND: [
          ...(searchWhere ? [searchWhere] : []),
          ...(filtersWhere ? [filtersWhere] : []),
          {
            OR: [
              { preparationStatus: null },
              { preparationStatus: { in: ['QUEUED', 'PREPARING', 'READY'] } },
            ],
          },
          ...(after
            ? [
                {
                  OR: [
                    { createdAt: { gt: after.createdAt } },
                    { createdAt: after.createdAt, id: { gt: after.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
        updatedAt: true,
      },
    });
    const orders = saved.slice(0, 25).map((order) => ({
      ...order,
      status: order.status as ActiveOrdersResponse['orders'][number]['status'],
      paymentStatus:
        order.paymentStatus as ActiveOrdersResponse['orders'][number]['paymentStatus'],
      preparationStatus:
        order.preparationStatus as ActiveOrdersResponse['orders'][number]['preparationStatus'],
      currency: 'PHP' as const,
      totalPrice: order.totalPrice.toFixed(2),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    }));
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
