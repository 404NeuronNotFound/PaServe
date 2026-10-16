import { BadRequestException } from '@nestjs/common';
import {
  normalizeOwnerOrderFilters,
  ownerOrderDateBounds,
  OWNER_ORDER_FILTER_FIELDS,
  type OwnerOrderView,
} from '@paserve/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { escapeOwnerOrderLikeLiteral } from './owner-order-search.js';

/** Select only known scalar query fields; tenant hints cannot become filters. */
export function ownerOrderFiltersFromQuery(query: Record<string, unknown>) {
  return Object.fromEntries(
    OWNER_ORDER_FILTER_FIELDS.map((field) => [field, query[field]]),
  );
}

export function ownerOrderFiltersWhere(
  raw: unknown,
  view: OwnerOrderView,
): Prisma.OrderWhereInput | undefined {
  const filters = normalizeOwnerOrderFilters(raw, view);
  if (filters === null)
    throw new BadRequestException({
      code: 'INVALID_ORDER_FILTERS',
      message: 'Choose valid filters and a From date on or before the To date.',
    });
  const conditions: Prisma.OrderWhereInput[] = [];
  if (filters.mode) conditions.push({ mode: filters.mode });
  if (filters.table)
    conditions.push({
      mode: 'DINE_IN',
      // Insensitive equals compiles to ILIKE: escape labels for literal equality.
      tableNumber: {
        equals: escapeOwnerOrderLikeLiteral(filters.table),
        mode: 'insensitive',
      },
    });
  if (filters.paymentMethod)
    conditions.push({
      paymentMethod:
        filters.paymentMethod === 'UNRECORDED' ? null : filters.paymentMethod,
    });
  switch (filters.status) {
    case 'PENDING_CONFIRMATION':
    case 'CONFIRMED':
    case 'REJECTED':
      conditions.push({ status: filters.status });
      break;
    case 'AWAITING_PAYMENT':
      conditions.push({
        status: 'CONFIRMED',
        paymentStatus: 'UNPAID',
        preparationStatus: null,
      });
      break;
    case 'AWAITING_PREPARATION':
      conditions.push({
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: null,
      });
      break;
    case 'QUEUED':
    case 'PREPARING':
    case 'READY':
    case 'COMPLETED':
      conditions.push({
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: filters.status,
      });
      break;
  }
  const bounds = ownerOrderDateBounds(filters);
  if (bounds.gte || bounds.lt)
    conditions.push({
      [view === 'completed' ? 'completedAt' : 'createdAt']: {
        ...(bounds.gte ? { gte: new Date(bounds.gte) } : {}),
        ...(bounds.lt ? { lt: new Date(bounds.lt) } : {}),
      },
    });
  return conditions.length ? { AND: conditions } : undefined;
}
