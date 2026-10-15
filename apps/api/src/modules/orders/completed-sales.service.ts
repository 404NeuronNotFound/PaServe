import { BadRequestException, Injectable } from '@nestjs/common';
import {
  SHOP_ROLES,
  hasShopPermission,
  type CompletedSalesResponse,
} from '@paserve/contracts';
import { isISO8601 } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';

export const COMPLETED_SALES_ROLES = SHOP_ROLES.filter((role) =>
  hasShopPermission(role, 'shop.reports.read'),
);
@Injectable()
export class CompletedSalesService {
  constructor(private readonly prisma: PrismaService) {}
  async summary(
    actorId: string,
    shopId: string,
    from: unknown,
    to: unknown,
  ): Promise<CompletedSalesResponse> {
    const utc = (value: unknown): value is string =>
      typeof value === 'string' &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) &&
      isISO8601(value, { strict: true });
    if (
      !utc(from) ||
      !utc(to) ||
      Date.parse(from) >= Date.parse(to) ||
      Date.parse(to) - Date.parse(from) > 366 * 86_400_000
    )
      throw new BadRequestException({
        code: 'INVALID_SALES_PERIOD',
        message:
          'Provide UTC from/to timestamps spanning at most 366 days, with from before to.',
      });
    const start = new Date(from),
      end = new Date(to);
    const result = await this.prisma.order.aggregate({
      where: {
        shopId,
        shop: shopAccessWhere(actorId, shopId, COMPLETED_SALES_ROLES),
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: 'COMPLETED',
        completedAt: { gte: start, lt: end },
        completedBy: { not: null },
        currency: 'PHP',
      },
      _count: { _all: true },
      _sum: { totalPrice: true },
    });
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      currency: 'PHP',
      completedOrders: result._count._all,
      totalSales: result._sum.totalPrice?.toFixed(2) ?? '0.00',
    };
  }
}
