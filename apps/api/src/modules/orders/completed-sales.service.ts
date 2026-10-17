import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  SHOP_ROLES,
  hasShopPermission,
  salesBusinessDayBounds,
  salesDailyRange,
  salesWeeklyRange,
  salesMonthlyRange,
  type MonthlyAnalyticsResponse,
  type WeeklyAnalyticsResponse,
  type DailyAnalyticsResponse,
  SALES_TIMEZONE,
  SALES_PAYMENT_METHODS,
  type RecentSalesOrder,
  type DailySalesResponse,
  type CustomSalesResponse,
  type CompletedSalesResponse,
  TOP_PRODUCT_METRICS,
  type TopProductsResponse,
  type TopProductMetric,
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
  async topProducts(
    actorId: string,
    shopId: string,
    startDate: unknown,
    endDate: unknown,
    metric: unknown,
  ): Promise<TopProductsResponse> {
    const range = salesDailyRange(startDate, endDate);
    if (!range)
      throw new BadRequestException({
        code: 'INVALID_SALES_PERIOD',
        message:
          'Choose valid start/end dates in order, spanning at most 366 days.',
      });
    if (!TOP_PRODUCT_METRICS.includes(metric as TopProductMetric))
      throw new BadRequestException({
        code: 'INVALID_PRODUCT_METRIC',
        message: 'Choose QUANTITY or REVENUE.',
      });
    return this.prisma.$transaction(
      async (tx) => {
        const access = await tx.shop.findFirst({
          where: shopAccessWhere(actorId, shopId, COMPLETED_SALES_ROLES),
          select: { id: true },
        });
        if (!access)
          throw new NotFoundException({
            code: 'SHOP_NOT_ACCESSIBLE',
            message: 'This shop is unavailable or you do not have access.',
          });
        const sort =
          metric === 'QUANTITY'
            ? Prisma.sql`quantity DESC, revenue DESC`
            : Prisma.sql`revenue DESC, quantity DESC`;
        const rows = await tx.$queryRaw<
          Array<{
            productSnapshotId: string;
            productName: string;
            quantity: Prisma.Decimal;
            revenue: Prisma.Decimal;
            totalQuantity: Prisma.Decimal;
            totalRevenue: Prisma.Decimal;
            productCount: bigint;
          }>
        >`
        WITH grouped AS (
          SELECT i."productSnapshotId",
            (array_agg(i."productNameSnapshot" ORDER BY o."completedAt" DESC, o.id DESC, i."lineNumber" DESC))[1] AS "productName",
            sum(i.quantity) AS quantity, sum(i."lineTotalSnapshot") AS revenue
          FROM order_items i JOIN orders o ON o.id = i."orderId" AND o."shopId" = i."shopId"
          WHERE i."shopId" = ${shopId} AND o."shopId" = ${shopId}
            AND o.status = 'CONFIRMED' AND o."paymentStatus" = 'PAID'
            AND o."preparationStatus" = 'COMPLETED' AND o."completedBy" IS NOT NULL
            AND o.currency = 'PHP' AND i.currency = 'PHP'
            AND o."completedAt" >= ${new Date(range.from)} AND o."completedAt" < ${new Date(range.to)}
          GROUP BY i."productSnapshotId"
        )
        SELECT *, sum(quantity) OVER () AS "totalQuantity", sum(revenue) OVER () AS "totalRevenue",
          count(*) OVER () AS "productCount"
        FROM grouped ORDER BY ${sort}, "productSnapshotId" COLLATE "C" ASC LIMIT 10
      `;
        const safe = (value: bigint | Prisma.Decimal) => {
          const count = Number(value);
          if (!Number.isSafeInteger(count) || count < 0)
            throw new InternalServerErrorException(
              'Product quantities could not be calculated.',
            );
          return count;
        };
        const products = rows.map((row) => {
          if (
            !row.productSnapshotId ||
            !row.productName ||
            row.productSnapshotId.length > 1000 ||
            row.productName.length > 1000 ||
            row.revenue.isNegative()
          )
            throw new InternalServerErrorException(
              'Saved product data is unavailable.',
            );
          return {
            productSnapshotId: row.productSnapshotId,
            productName: row.productName,
            quantity: safe(row.quantity),
            revenue: row.revenue.toFixed(2),
          };
        });
        const totalQuantity = rows[0] ? safe(rows[0].totalQuantity) : 0;
        const totalRevenue = rows[0]?.totalRevenue ?? new Prisma.Decimal(0);
        const otherQuantity =
          totalQuantity -
          products.reduce((n, product) => n + product.quantity, 0);
        const otherRevenue = totalRevenue.minus(
          products.reduce(
            (n, product) => n.plus(product.revenue),
            new Prisma.Decimal(0),
          ),
        );
        if (otherQuantity < 0 || otherRevenue.isNegative())
          throw new InternalServerErrorException(
            'Product totals could not be reconciled.',
          );
        return {
          shopId,
          startDate: startDate as string,
          endDate: endDate as string,
          from: range.from,
          to: range.to,
          timezone: SALES_TIMEZONE,
          currency: 'PHP',
          metric: metric as TopProductMetric,
          limit: 10,
          productCount: rows[0] ? safe(rows[0].productCount) : 0,
          totalQuantity,
          totalRevenue: totalRevenue.toFixed(2),
          otherQuantity,
          otherRevenue: otherRevenue.toFixed(2),
          products,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async monthlyAnalytics(
    actorId: string,
    shopId: string,
    startDate: unknown,
    endDate: unknown,
  ): Promise<MonthlyAnalyticsResponse> {
    const range = salesMonthlyRange(startDate, endDate);
    if (!range)
      throw new BadRequestException({
        code: 'INVALID_SALES_PERIOD',
        message:
          'Choose valid start/end business dates in order, spanning at most 366 days.',
      });
    // Use the same authorized reporting snapshot and eligibility as Daily.
    const { days, ...summary } = await this.dailyAnalytics(
      actorId,
      shopId,
      startDate,
      endDate,
    );
    const months = range.months.map((period) => {
      const included = days.filter(
        (day) => day.businessDate.slice(0, 7) === period.month,
      );
      return {
        ...period,
        completedOrders: included.reduce(
          (n, day) => n + day.completedOrders,
          0,
        ),
        itemsSold: included.reduce((n, day) => n + day.itemsSold, 0),
        totalSales: included
          .reduce((n, day) => n.plus(day.totalSales), new Prisma.Decimal(0))
          .toFixed(2),
      };
    });
    return { ...summary, aggregation: 'CALENDAR_MONTH', months };
  }
  async weeklyAnalytics(
    actorId: string,
    shopId: string,
    startDate: unknown,
    endDate: unknown,
  ): Promise<WeeklyAnalyticsResponse> {
    const range = salesWeeklyRange(startDate, endDate);
    if (!range)
      throw new BadRequestException({
        code: 'INVALID_SALES_PERIOD',
        message:
          'Choose valid start/end business dates in order, spanning at most 366 days with representable Monday-Sunday boundaries.',
      });
    // Reuse the reconciled daily query and its single authorized snapshot.
    // At most 366 daily aggregates are folded; no per-week database queries.
    const { days, ...summary } = await this.dailyAnalytics(
      actorId,
      shopId,
      startDate,
      endDate,
    );
    const weeks = range.weeks.map((period) => {
      const included = days.filter(
        (day) =>
          day.businessDate >= period.fromDate &&
          day.businessDate <= period.toDate,
      );
      return {
        ...period,
        completedOrders: included.reduce(
          (n, day) => n + day.completedOrders,
          0,
        ),
        itemsSold: included.reduce((n, day) => n + day.itemsSold, 0),
        totalSales: included
          .reduce((n, day) => n.plus(day.totalSales), new Prisma.Decimal(0))
          .toFixed(2),
      };
    });
    return { ...summary, weekStartsOn: 'MONDAY', weeks };
  }
  async dailyAnalytics(
    actorId: string,
    shopId: string,
    startDate: unknown,
    endDate: unknown,
  ): Promise<DailyAnalyticsResponse> {
    const range = salesDailyRange(startDate, endDate);
    if (!range)
      throw new BadRequestException({
        code: 'INVALID_SALES_PERIOD',
        message:
          'Choose valid start/end business dates in order, spanning at most 366 days.',
      });
    return this.prisma.$transaction(
      async (tx) => {
        const access = await tx.shop.findFirst({
          where: shopAccessWhere(actorId, shopId, COMPLETED_SALES_ROLES),
          select: { id: true },
        });
        if (!access)
          throw new NotFoundException({
            code: 'SHOP_NOT_ACCESSIBLE',
            message: 'This shop is unavailable or you do not have access.',
          });
        // Aggregate item quantities per order before grouping, so item lines cannot
        // multiply order counts or money. All reads share the access-check snapshot.
        const rows = await tx.$queryRaw<
          Array<{
            businessDate: string;
            completedOrders: bigint;
            totalSales: Prisma.Decimal;
            itemsSold: Prisma.Decimal;
          }>
        >`
        SELECT to_char(o."completedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS "businessDate",
          count(*) AS "completedOrders", sum(o."totalPrice") AS "totalSales",
          sum(coalesce(items.quantity, 0)) AS "itemsSold"
        FROM orders o
        LEFT JOIN LATERAL (
          SELECT sum(i.quantity) AS quantity FROM order_items i
          WHERE i."shopId" = ${shopId} AND i."orderId" = o.id
        ) items ON true
        WHERE o."shopId" = ${shopId} AND o.status = 'CONFIRMED'
          AND o."paymentStatus" = 'PAID' AND o."preparationStatus" = 'COMPLETED'
          AND o."completedBy" IS NOT NULL AND o.currency = 'PHP'
          AND o."completedAt" >= ${new Date(range.from)}
          AND o."completedAt" < ${new Date(range.to)}
        GROUP BY 1 ORDER BY 1
      `;
        const safeCount = (value: bigint | Prisma.Decimal) => {
          const count = Number(value);
          if (!Number.isSafeInteger(count) || count < 0)
            throw new InternalServerErrorException(
              'Daily analytics could not be calculated.',
            );
          return count;
        };
        const byDate = new Map(rows.map((row) => [row.businessDate, row]));
        const days = range.dates.map((businessDate) => {
          const row = byDate.get(businessDate);
          return {
            businessDate,
            completedOrders: row ? safeCount(row.completedOrders) : 0,
            totalSales: row ? row.totalSales.toFixed(2) : '0.00',
            itemsSold: row ? safeCount(row.itemsSold) : 0,
          };
        });
        return {
          shopId,
          startDate: startDate as string,
          endDate: endDate as string,
          timezone: SALES_TIMEZONE,
          currency: 'PHP',
          from: range.from,
          to: range.to,
          completedOrders: safeCount(
            days.reduce((n, day) => n + BigInt(day.completedOrders), 0n),
          ),
          itemsSold: safeCount(
            days.reduce((n, day) => n + BigInt(day.itemsSold), 0n),
          ),
          totalSales: days
            .reduce((n, day) => n.plus(day.totalSales), new Prisma.Decimal(0))
            .toFixed(2),
          days,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
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
    return {
      ...(await this.reportForBounds(actorId, shopId, bounds)),
      businessDate: date as string,
    };
  }
  async custom(
    actorId: string,
    shopId: string,
    startDate: unknown,
    endDate: unknown,
  ): Promise<CustomSalesResponse> {
    const range = salesDailyRange(startDate, endDate);
    if (!range)
      throw new BadRequestException({
        code: 'INVALID_SALES_PERIOD',
        message:
          'Choose valid start/end business dates in order, spanning at most 366 days.',
      });
    return {
      ...(await this.reportForBounds(actorId, shopId, range)),
      startDate: startDate as string,
      endDate: endDate as string,
    };
  }
  private async reportForBounds(
    actorId: string,
    shopId: string,
    bounds: { from: string; to: string },
  ): Promise<Omit<DailySalesResponse, 'businessDate'>> {
    const start = new Date(bounds.from),
      end = new Date(bounds.to);
    const { summary, itemsSold, paymentBreakdown, recentOrders } =
      await this.prisma.$transaction(
        async (tx) => {
          // Distinguish an inaccessible shop from a legitimately empty period,
          // including membership changes after the route guard resolved.
          const access = await tx.shop.findFirst({
            where: shopAccessWhere(actorId, shopId, COMPLETED_SALES_ROLES),
            select: { id: true },
          });
          if (!access)
            throw new NotFoundException({
              code: 'SHOP_NOT_ACCESSIBLE',
              message: 'This shop is unavailable or you do not have access.',
            });
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
          const groups = await tx.order.groupBy({
            by: ['paymentMethod'],
            where: this.eligibleOrders(actorId, shopId, start, end),
            _count: { _all: true },
            _sum: { totalPrice: true },
          });
          if (
            groups.some(
              (group) =>
                !SALES_PAYMENT_METHODS.some(
                  (method) => method === group.paymentMethod,
                ),
            )
          ) {
            throw new InternalServerErrorException(
              'Payment breakdown could not be calculated.',
            );
          }
          const paymentBreakdown = SALES_PAYMENT_METHODS.map(
            (paymentMethod) => {
              const group = groups.find(
                (row) => row.paymentMethod === paymentMethod,
              );
              return {
                paymentMethod,
                orders: group?._count._all ?? 0,
                totalSales: group?._sum.totalPrice?.toFixed(2) ?? '0.00',
              };
            },
          );
          const groupedTotal = paymentBreakdown.reduce(
            (sum, group) => sum.plus(group.totalSales),
            new Prisma.Decimal(0),
          );
          if (
            paymentBreakdown.reduce((sum, group) => sum + group.orders, 0) !==
              summary.completedOrders ||
            !groupedTotal.equals(summary.totalSales)
          ) {
            throw new InternalServerErrorException(
              'Payment breakdown does not match the sales summary.',
            );
          }
          const savedRecent = await tx.order.findMany({
            where: this.eligibleOrders(actorId, shopId, start, end),
            orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
            take: 10,
            select: {
              id: true,
              shopId: true,
              orderNumber: true,
              status: true,
              paymentStatus: true,
              preparationStatus: true,
              currency: true,
              totalPrice: true,
              completedAt: true,
            },
          });
          const recentOrders = savedRecent.map((order): RecentSalesOrder => {
            if (!order.completedAt)
              throw new InternalServerErrorException(
                'Recent orders could not be loaded.',
              );
            return {
              ...order,
              status: 'CONFIRMED',
              paymentStatus: 'PAID',
              preparationStatus: 'COMPLETED',
              currency: 'PHP',
              totalPrice: order.totalPrice.toFixed(2),
              completedAt: order.completedAt.toISOString(),
            };
          });
          return { summary, itemsSold, paymentBreakdown, recentOrders };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    return {
      ...summary,
      itemsSold,
      paymentBreakdown,
      recentOrders,
      shopId,
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
