import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { collectionPage } from './collection-page.js';
import { productPage } from '../../modules/products/product-page.js';

describe('Bounded collection pages', () => {
  it.each(['0', '-1', '01', '1.5', '101', '1000', 100, null, [], {}])(
    'rejects invalid page size %j',
    (limit) => {
      expect(() => collectionPage({ limit }, 'shop-a')).toThrow();
    },
  );
  it('caps defaults and emits a context-bound cursor using a sentinel row', () => {
    const rows = Array.from({ length: 101 }, () => ({
      id: randomUUID(),
      sortOrder: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }));
    const page = collectionPage({}, 'products:a');
    expect(page.take).toBe(101);
    const result = page.finish(rows);
    expect(result.items).toHaveLength(100);
    expect(
      collectionPage({ cursor: result.nextCursor }, 'products:a').where,
    ).toMatchObject({ OR: expect.any(Array) });
    expect(() =>
      collectionPage({ cursor: result.nextCursor }, 'products:b'),
    ).toThrow();
    expect(() =>
      collectionPage({ cursor: result.nextCursor }, 'categories:a'),
    ).toThrow();
    expect(page.finish(rows.slice(0, 100)).nextCursor).toBeNull();
    expect(page.finish([])).toEqual({ items: [], nextCursor: null });
  });
  it.each(['', 'bad!', 'x'.repeat(1201), ['cursor'], {}, null])(
    'rejects invalid cursors %j',
    (cursor) => {
      expect(() => collectionPage({ cursor }, 'products:a')).toThrow();
    },
  );
  it('keeps category/status/archive filters outside cursor OR and binds the cursor to them', () => {
    const categoryId = randomUUID();
    const page = productPage(
      { categoryId, status: 'AVAILABLE', isArchived: 'false', limit: '1' },
      'shop',
    );
    const cursor = page.finish(
      Array.from({ length: 2 }, () => ({
        id: randomUUID(),
        sortOrder: 0,
        createdAt: new Date(),
      })),
    ).nextCursor;
    expect(
      productPage(
        { categoryId, status: 'AVAILABLE', isArchived: 'false', cursor },
        'shop',
      ).where,
    ).toMatchObject({
      categoryId,
      status: 'AVAILABLE',
      isArchived: false,
      OR: expect.any(Array),
    });
    expect(() =>
      productPage(
        { categoryId, status: 'HIDDEN', isArchived: 'false', cursor },
        'shop',
      ),
    ).toThrow();
    expect(
      productPage({ categoryId: 'uncategorized' }, 'shop').where.categoryId,
    ).toBeNull();
  });
  it.each([
    { status: ['AVAILABLE'] },
    { isArchived: [] },
    { categoryId: {} },
    { categoryId: 'foreign' },
    { isArchived: 'yes' },
    { status: 'OTHER' },
  ])('rejects invalid filters %j', (query) => {
    expect(() => productPage(query, 'shop')).toThrow();
  });
});
