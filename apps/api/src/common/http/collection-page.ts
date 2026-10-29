import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';

export const COLLECTION_PAGE_MAX = 100;
export type CollectionQuery = { cursor?: unknown; limit?: unknown };
type Position = { sortOrder: number; createdAt: string; id: string };
export function collectionPage(query: CollectionQuery, context: string) {
  const invalid = () =>
    new BadRequestException({
      code: 'INVALID_COLLECTION_PAGE',
      message:
        'Use a valid page size and cursor. Refresh the list to start again.',
    });
  if (
    query.limit !== undefined &&
    (typeof query.limit !== 'string' ||
      !/^[1-9]\d{0,2}$/.test(query.limit) ||
      Number(query.limit) > COLLECTION_PAGE_MAX)
  )
    throw invalid();
  const limit =
    query.limit === undefined ? COLLECTION_PAGE_MAX : Number(query.limit);
  let after: Position | undefined;
  if (query.cursor !== undefined) {
    if (
      typeof query.cursor !== 'string' ||
      !/^[A-Za-z0-9_-]{1,1200}$/.test(query.cursor)
    )
      throw invalid();
    try {
      const decoded = Buffer.from(query.cursor, 'base64url');
      if (decoded.toString('base64url') !== query.cursor) throw invalid();
      const value = JSON.parse(decoded.toString('utf8')) as {
        v: unknown;
        context: unknown;
        after: Position;
      };
      if (
        value.v !== 1 ||
        value.context !== context ||
        !Number.isInteger(value.after.sortOrder) ||
        value.after.sortOrder < 0 ||
        value.after.sortOrder > 2147483647 ||
        typeof value.after.createdAt !== 'string' ||
        new Date(value.after.createdAt).toISOString() !==
          value.after.createdAt ||
        typeof value.after.id !== 'string' ||
        !isUUID(value.after.id)
      )
        throw invalid();
      after = value.after;
    } catch {
      throw invalid();
    }
  }
  return {
    limit,
    take: limit + 1,
    where: after
      ? {
          OR: [
            { sortOrder: { gt: after.sortOrder } },
            {
              sortOrder: after.sortOrder,
              createdAt: { gt: new Date(after.createdAt) },
            },
            {
              sortOrder: after.sortOrder,
              createdAt: new Date(after.createdAt),
              id: { gt: after.id },
            },
          ],
        }
      : {},
    finish<T extends { id: string; sortOrder: number; createdAt: Date }>(
      rows: T[],
    ) {
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(
                JSON.stringify({
                  v: 1,
                  context,
                  after: {
                    sortOrder: last.sortOrder,
                    createdAt: last.createdAt.toISOString(),
                    id: last.id,
                  },
                }),
              ).toString('base64url')
            : null,
      };
    },
  };
}
