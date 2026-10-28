import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { HistoryPagination } from '@paserve/contracts';
import type { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

export type HistoryPagingQuery = { page?: unknown; snapshot?: unknown };

export function parseHistoryPaging(
  query: HistoryPagingQuery,
  cursor?: unknown,
) {
  if (query.page === undefined && query.snapshot === undefined)
    return undefined;
  if (
    cursor !== undefined ||
    typeof query.page !== 'string' ||
    !/^[1-9]\d{0,8}$/.test(query.page)
  )
    throw new BadRequestException('Invalid history page.');
  const now = new Date();
  let snapshot = now;
  if (query.snapshot !== undefined) {
    if (
      typeof query.snapshot !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(query.snapshot)
    )
      throw new BadRequestException('Invalid history snapshot.');
    snapshot = new Date(query.snapshot);
    if (
      !Number.isFinite(snapshot.getTime()) ||
      snapshot.toISOString() !== query.snapshot ||
      snapshot > now
    )
      throw new BadRequestException('Invalid history snapshot.');
  }
  return { page: Number(query.page), snapshot };
}

/** Count and fetch share a transaction snapshot and exactly the same tenant/filter predicate. */
export async function readHistoryPage<T>(
  prisma: PrismaService,
  paging: { page: number; snapshot: Date },
  where: Prisma.OrderWhereInput,
  cutoff: Prisma.OrderWhereInput,
  read: (
    tx: Prisma.TransactionClient,
    where: Prisma.OrderWhereInput,
    skip: number,
    take: number,
  ) => Promise<T[]>,
): Promise<{ saved: T[]; pagination: HistoryPagination }> {
  // Counts and "has new" probes must never silently become cross-shop scans
  // when a future caller omits or broadens the tenant predicate.
  if (typeof where.shopId !== 'string' || !isUUID(where.shopId))
    throw new BadRequestException({
      code: 'INVALID_TENANT_CONTEXT',
      message: 'A valid shop context is required.',
    });
  return prisma.$transaction(
    async (tx) => {
      const frozenWhere = { AND: [where, cutoff] };
      const total = await tx.order.count({ where: frozenWhere });
      const pageCount = Math.max(1, Math.ceil(total / 12));
      const page = Math.min(paging.page, pageCount);
      const saved = await read(tx, frozenWhere, (page - 1) * 12, 12);
      const newer = await tx.order.findFirst({
        where: { AND: [where, { NOT: cutoff }] },
        select: { id: true },
      });
      return {
        saved,
        pagination: {
          page,
          pageCount,
          pageSize: 12,
          total,
          snapshot: paging.snapshot.toISOString(),
          hasNew: Boolean(newer),
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
