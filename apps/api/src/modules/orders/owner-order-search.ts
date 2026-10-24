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
  const matches: Prisma.OrderWhereInput[] = [
    { orderNumber: { contains: literal, mode: 'insensitive' } },
    { tableNumber: { contains: literal, mode: 'insensitive' } },
  ];
  // Table labels may be saved as "2" or "Patio", without a "Table" prefix.
  const tableLabel = /^table(?:\s+|(?=[#:]))(.*)$/i
    .exec(search)?.[1]
    ?.trim()
    .replace(/^[#:]\s*/, '')
    .trim();
  if (tableLabel)
    matches.push({
      tableNumber: {
        contains: escapeOwnerOrderLikeLiteral(tableLabel),
        mode: 'insensitive',
      },
    });

  // Recognize displayed workflow terms without broad fuzzy database scans.
  const keyword = search.toLowerCase().replace(/[\s_-]+/g, '');
  const terms: Record<string, Prisma.OrderWhereInput> = {
    dinein: { mode: 'DINE_IN' },
    takeout: { mode: 'TAKEOUT' },
    takeaway: { mode: 'TAKEOUT' },
    pickup: { mode: 'TAKEOUT' },
    pending: { status: 'PENDING_CONFIRMATION' },
    pendingconfirmation: { status: 'PENDING_CONFIRMATION' },
    confirmed: { status: 'CONFIRMED' },
    queued: { preparationStatus: 'QUEUED' },
    queue: { preparationStatus: 'QUEUED' },
    queud: { preparationStatus: 'QUEUED' },
    preparing: { preparationStatus: 'PREPARING' },
    prepare: { preparationStatus: 'PREPARING' },
    ready: { preparationStatus: 'READY' },
    readytoserve: { preparationStatus: 'READY' },
    completed: { preparationStatus: 'COMPLETED' },
    rejected: { status: 'REJECTED' },
    cancelled: { status: 'REJECTED' },
    canceled: { status: 'REJECTED' },
    paid: { paymentStatus: 'PAID' },
    unpaid: { paymentStatus: 'UNPAID' },
  };
  // Live search must match while a term is still being typed ("take", "prep").
  // Expand only known aliases in memory, then query enum equality. Deduplicate
  // aliases such as takeout/takeaway so prefixes do not add redundant SQL.
  const seen = new Set<string>();
  for (const [term, predicate] of Object.entries(terms)) {
    if (term !== keyword && !(keyword.length >= 2 && term.startsWith(keyword)))
      continue;
    const key = JSON.stringify(predicate);
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(predicate);
  }
  return { OR: matches };
}
