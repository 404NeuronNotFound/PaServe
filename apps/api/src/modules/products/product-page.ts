import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  collectionPage,
  type CollectionQuery,
} from '../../common/http/collection-page.js';
export type ProductPageQuery = CollectionQuery & {
  categoryId?: unknown;
  status?: unknown;
  isArchived?: unknown;
};
export function productPage(query: ProductPageQuery, shopId: string) {
  const invalid = () =>
    new BadRequestException({
      code: 'INVALID_COLLECTION_FILTER',
      message: 'Use valid category, status and archive filters.',
    });
  if (
    query.categoryId !== undefined &&
    (typeof query.categoryId !== 'string' ||
      (query.categoryId !== 'uncategorized' && !isUUID(query.categoryId)))
  )
    throw invalid();
  if (
    query.status !== undefined &&
    (typeof query.status !== 'string' ||
      !['AVAILABLE', 'SOLD_OUT', 'HIDDEN'].includes(query.status))
  )
    throw invalid();
  if (
    query.isArchived !== undefined &&
    (typeof query.isArchived !== 'string' ||
      !['true', 'false'].includes(query.isArchived))
  )
    throw invalid();
  const page = collectionPage(
    query,
    `products:${shopId}:${JSON.stringify([query.categoryId ?? null, query.status ?? null, query.isArchived ?? null])}`,
  );
  return {
    ...page,
    where: {
      ...page.where,
      ...(query.categoryId !== undefined
        ? {
            categoryId:
              query.categoryId === 'uncategorized'
                ? null
                : (query.categoryId as string),
          }
        : {}),
      ...(query.status !== undefined
        ? { status: query.status as 'AVAILABLE' | 'SOLD_OUT' | 'HIDDEN' }
        : {}),
      ...(query.isArchived !== undefined
        ? { isArchived: query.isArchived === 'true' }
        : {}),
    },
  };
}
