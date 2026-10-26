import { parseHistoryPaging, readHistoryPage } from './history-pagination.js';
import { rolesForShopPermissions } from '@paserve/contracts';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { isUUID, isISO8601 } from 'class-validator';
import {
  type PreparationQueueResponse,
  type PreparationStatus,
} from '@paserve/contracts';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';
import { readPriceSnapshot } from './order-price-snapshots.js';

export const PREPARATION_QUEUE_ROLES = rolesForShopPermissions(
  'shop.preparation.queue.read',
);

@Injectable()
export class PreparationQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    actorId: string,
    shopId: string,
    cursor?: string,
    preparationStatus: PreparationStatus = 'QUEUED',
    history: {
      search?: unknown;
      from?: unknown;
      to?: unknown;
      limit?: unknown;
      page?: unknown;
      snapshot?: unknown;
    } = {},
  ): Promise<PreparationQueueResponse> {
    const access = shopAccessWhere(actorId, shopId, PREPARATION_QUEUE_ROLES);
    const completed = preparationStatus === 'COMPLETED';
    const paging = parseHistoryPaging(history, cursor);
    if (paging && !completed)
      throw new BadRequestException(
        'Numbered pages are only available for completed history.',
      );
    if (
      history.limit !== undefined &&
      (typeof history.limit !== 'string' || !/^(12|50)$/.test(history.limit))
    )
      throw new BadRequestException('Invalid history page size.');
    const limit = history.limit === undefined ? 50 : Number(history.limit);
    const search = history.search === undefined ? '' : history.search;
    const parseDate = (value: unknown): Date | undefined => {
      if (value === undefined) return undefined;
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
        !isISO8601(value, { strict: true, strictSeparator: true }) ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        throw new BadRequestException('Invalid history date.');
      return new Date(value);
    };
    const from = parseDate(history.from),
      to = parseDate(history.to);
    if (
      ![12, 50].includes(limit) ||
      typeof search !== 'string' ||
      search.length > 32 ||
      !/^[A-Za-z0-9-]*$/.test(search) ||
      (from && to && from >= to)
    )
      throw new BadRequestException('Invalid history filters.');
    let after: { queuedAt: Date; id: string } | undefined;
    if (cursor !== undefined) {
      try {
        if (
          typeof cursor !== 'string' ||
          cursor.length > 200 ||
          !/^[A-Za-z0-9_-]+$/.test(cursor)
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
        after = { queuedAt: new Date(values[0]), id: values[1] };
      } catch {
        throw new BadRequestException({
          code: 'INVALID_QUEUE_CURSOR',
          message: 'Refresh the preparation queue.',
        });
      }
    }
    const args = {
      where: {
        shopId,
        shop: access,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus,
        queuedAt: { not: null },
        ...(completed
          ? {
              completedAt: {
                not: null,
                ...(from ? { gte: from } : {}),
                ...(to ? { lt: to } : {}),
              },
              ...(search
                ? { orderNumber: { contains: search.toUpperCase() } }
                : {}),
            }
          : {}),
        ...(after
          ? {
              OR: completed
                ? [
                    { completedAt: { lt: after.queuedAt } },
                    { completedAt: after.queuedAt, id: { lt: after.id } },
                  ]
                : [
                    { queuedAt: { gt: after.queuedAt } },
                    { queuedAt: after.queuedAt, id: { gt: after.id } },
                  ],
            }
          : {}),
      },
      orderBy: completed
        ? [{ completedAt: 'desc' }, { id: 'desc' }]
        : [{ queuedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: {
        id: true,
        shopId: true,
        orderNumber: true,
        mode: true,
        serviceType: true,
        tableNumber: true,
        currency: true,
        totalPrice: true,
        queuedAt: true,
        preparationStartedAt: true,
        preparationStartedBy: true,
        preparationReadyAt: true,
        preparationReadyBy: true,
        completedAt: true,
        completedBy: true,
        orderItems: {
          where: {
            shopId,
            order: {
              shopId,
              shop: access,
              status: 'CONFIRMED',
              paymentStatus: 'PAID',
              preparationStatus,
            },
          },
          orderBy: { lineNumber: 'asc' },
          select: {
            productSnapshotId: true,
            lineNumber: true,
            productNameSnapshot: true,
            currency: true,
            quantity: true,
            notes: true,
            basePriceSnapshot: true,
            unitPriceSnapshot: true,
            lineTotalSnapshot: true,
            variantsSnapshot: true,
            addOnsSnapshot: true,
          },
        },
      },
    } satisfies Prisma.OrderFindManyArgs;
    const numbered = paging
      ? await readHistoryPage(
          this.prisma,
          paging,
          args.where,
          { completedAt: { lte: paging.snapshot } },
          (tx, where, skip, take) =>
            tx.order.findMany({ ...args, where, skip, take }),
        )
      : undefined;
    const saved = numbered
      ? numbered.saved
      : await this.prisma.order.findMany(args);
    const page = saved.slice(0, paging ? 12 : limit);
    const orders = page.map((order) => {
      let items: PreparationQueueResponse['orders'][number]['items'];
      try {
        if (
          !order.orderItems.length ||
          order.orderItems.length > 100 ||
          order.orderItems.some((item, index) => item.lineNumber !== index + 1)
        )
          throw new Error('Invalid queue receipt lines');
        items = order.orderItems.map(readPriceSnapshot);
        if (
          !order.queuedAt ||
          (preparationStatus !== 'QUEUED' &&
            (!order.preparationStartedAt ||
              !order.preparationStartedBy ||
              order.preparationStartedAt < order.queuedAt)) ||
          ((preparationStatus === 'READY' || completed) &&
            (!order.preparationReadyAt ||
              !order.preparationReadyBy ||
              order.preparationReadyAt < order.preparationStartedAt!)) ||
          (completed &&
            (!order.completedAt ||
              !order.completedBy ||
              order.completedAt < order.preparationReadyAt!)) ||
          order.currency !== 'PHP' ||
          !items.length ||
          !items
            .reduce(
              (total, item) => total.plus(item.totalPrice),
              new Prisma.Decimal(0),
            )
            .equals(order.totalPrice)
        )
          throw new Error('Invalid queue receipt total');
      } catch {
        throw new ConflictException({
          code: 'QUEUE_RECEIPT_UNAVAILABLE',
          message: 'The saved queue receipt could not be loaded.',
        });
      }
      return {
        id: order.id,
        shopId: order.shopId,
        orderNumber: order.orderNumber,
        mode: order.mode,
        serviceType: order.serviceType,
        tableNumber: order.tableNumber,
        currency: 'PHP' as const,
        totalPrice: order.totalPrice.toFixed(2),
        queuedAt: order.queuedAt.toISOString(),
        preparationStatus,
        preparationStartedAt: order.preparationStartedAt?.toISOString() ?? null,
        preparationStartedBy: order.preparationStartedBy ?? null,
        preparationReadyAt: order.preparationReadyAt?.toISOString() ?? null,
        preparationReadyBy: order.preparationReadyBy ?? null,
        completedAt: order.completedAt?.toISOString() ?? null,
        completedBy: order.completedBy ?? null,
        items,
      };
    });
    const last = orders.at(-1);
    return {
      orders,
      ...(numbered ? { pagination: numbered.pagination } : {}),
      nextCursor:
        !paging && saved.length > limit && last
          ? Buffer.from(
              JSON.stringify([
                completed ? last.completedAt : last.queuedAt,
                last.id,
              ]),
            ).toString('base64url')
          : null,
    };
  }
}
