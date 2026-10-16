import { BadRequestException } from '@nestjs/common';
import { normalizeOwnerOrderSearch } from '@paserve/contracts';
import type { Prisma } from '../../generated/prisma/client.js';

export function escapeOwnerOrderLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** Keep this OR inside the existing tenant/state/cursor predicates. */
export function ownerOrderSearchWhere(
  value: unknown,
): Prisma.OrderWhereInput | undefined {
  const search = normalizeOwnerOrderSearch(value);
  if (search === null)
    throw new BadRequestException({
      code: 'INVALID_ORDER_SEARCH',
      message:
        'Search must be at most 80 characters without control characters.',
    });
  if (!search) return undefined;
  // Prisma contains uses LIKE: escape wildcards so user text stays literal.
  const literal = escapeOwnerOrderLikeLiteral(search);
  return {
    OR: [
      { orderNumber: { contains: literal, mode: 'insensitive' } },
      { tableNumber: { contains: literal, mode: 'insensitive' } },
    ],
  };
}
