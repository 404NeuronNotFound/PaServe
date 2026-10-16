import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  SHOP_ROLES,
  hasShopPermission,
  salesBusinessDayBounds,
  SALES_TIMEZONE,
  type DailySalesResponse,
  type CompletedSalesResponse,
} from '@paserve/contracts';
import { isISO8601 } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';
import { Prisma } from '../../generated/prisma/client.js';

export const COMPLETED_SALES_ROLES = SHOP_ROLES.filter((role) =>
  hasShopPermission(role, 'shop.reports.read'),
);
@Injectable()
export class CompletedSalesService {
  constructor(private readonly prisma: PrismaService) {}
  async daily(
    actorId: string,
    shopId: string,
    date: unknown,
  ): Promise<DailySalesResponse> {
    const bounds = salesBusinessDayBounds(date);
    if (!bounds)
      throw new BadRequestException({
        code: 'INVALID_SALES_DATE',
        message: 'Provide a valid business date as YYYY-MM-DD in Asia/Manila.',
      });
    const start = new Date(bounds.from),
      end = new Date(bounds.to);
    const { summary, itemsSold } = await this.prisma.$transaction(
      async (tx) => {
        const summary = await this.aggregate(actorId, shopId, start, end, tx);
        const items = await tx.orderItem.aggregate({
          where: {
            shopId,
            order: this.eligibleOrders(actorId, shopId, start, end),
          },
          _sum: { quantity: true },
        });
        const itemsSold = items._sum.quantity ?? 0;
        if (!Number.isSafeInteger(itemsSold) || itemsSold < 0)
          throw new InternalServerErrorException(
            'Items sold could not be calculated.',
          );
        return { summary, itemsSold };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      ...summary,
      itemsSold,
      shopId,
      businessDate: date as string,
      timezone: SALES_TIMEZONE,
    };
  }
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
    return this.aggregate(actorId, shopId, start, end);
  }

  private async aggregate(
    actorId: string,
    shopId: string,
    start: Date,
    end: Date,
    database: Pick<Prisma.TransactionClient, 'order'> = this.prisma,
  ): Promise<CompletedSalesResponse> {
    const result = await database.order.aggregate({
      where: this.eligibleOrders(actorId, shopId, start, end),
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

  private eligibleOrders(
    actorId: string,
    shopId: string,
    start: Date,
    end: Date,
  ): Prisma.OrderWhereInput {
    return {
      shopId,
      shop: shopAccessWhere(actorId, shopId, COMPLETED_SALES_ROLES),
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      preparationStatus: 'COMPLETED',
      completedAt: { gte: start, lt: end },
      completedBy: { not: null },
      currency: 'PHP',
    };
  }
}
