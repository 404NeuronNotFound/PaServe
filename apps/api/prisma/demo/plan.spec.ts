import { describe, it, expect } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client.js';
import { copyPriceSnapshot } from '../../src/modules/orders/order-price-snapshots.js';
import type { ProductSelectionQuoteResponse } from '@paserve/contracts';
import { buildPlan } from './plan.js';
import { assertDemoSafety } from './safety.js';

describe('development seed safety', () => {
  const env = {
    NODE_ENV: 'development',
    ALLOW_DEMO_SEED: 'true',
    DATABASE_URL: 'postgresql://demo:secret@localhost:5432/paserve',
    DEMO_DATABASE_TARGET: 'localhost/paserve',
  };
  it('requires explicit non-production mode, opt-in and the exact target', () => {
    expect(assertDemoSafety(env)).toBe('localhost/paserve');
    for (const change of [
      { NODE_ENV: 'production' },
      { NODE_ENV: undefined },
      { ALLOW_DEMO_SEED: undefined },
      { DEMO_DATABASE_TARGET: 'other/paserve' },
      { DATABASE_URL: 'https://localhost/paserve' },
    ])
      expect(() => assertDemoSafety({ ...env, ...change })).toThrow();
  });
});

describe('month-old demo operating environment', () => {
  const now = new Date('2026-10-22T15:00:00+08:00');
  const plan = buildPlan(now, 'test-hash');
  it('is deterministic and meets data targets', () => {
    const again = buildPlan(now, 'test-hash');
    expect(
      JSON.stringify(plan, (_key, value: unknown) =>
        typeof value === 'bigint' ? String(value) : value,
      ),
    ).toBe(
      JSON.stringify(again, (_key, value: unknown) =>
        typeof value === 'bigint' ? String(value) : value,
      ),
    );
    expect(plan.shops).toHaveLength(5);
    expect(
      plan.shops.reduce((n, shop) => n + shop.orders.length, 0),
    ).toBeGreaterThan(5000);
    expect(
      plan.shops.reduce((n, shop) => n + shop.items.length, 0),
    ).toBeGreaterThan(10000);
    expect(plan.manifest).toHaveLength(200);
  });
  it('keeps selections, snapshots, cashiers, tables and timelines inside their tenants', () => {
    for (const shop of plan.shops) {
      expect(shop.users).toHaveLength(7);
      expect(shop.products).toHaveLength(40);
      const products = new Set(shop.products.map((p) => p.id));
      const cashiers = new Set(
        shop.members
          .filter((m) =>
            ['CASHIER', 'OWNER', 'ADMIN', 'MANAGER'].includes(m.role),
          )
          .map((m) => m.userId),
      );
      const tableIds = new Set(shop.tables.map((table) => table.id));
      const byOrder = new Map<string, typeof shop.items>();
      for (const item of shop.items) {
        const lines = byOrder.get(item.orderId) ?? [];
        lines.push(item);
        byOrder.set(item.orderId, lines);
      }
      for (const order of shop.orders) {
        expect(cashiers.has(order.decidedBy!)).toBe(true);
        expect(
          order.mode === 'TAKEOUT'
            ? order.tableId === null
            : tableIds.has(order.tableId!),
        ).toBe(true);
        const lines = byOrder.get(order.id!)!;
        for (const item of lines) {
          expect(products.has(item.productId!)).toBe(true);
          const snapshot = copyPriceSnapshot(
            item.snapshot as unknown as ProductSelectionQuoteResponse,
          );
          for (const variant of snapshot.variants)
            expect(
              shop.variants.some(
                (v) => v.id === variant.id && v.productId === item.productId,
              ),
            ).toBe(true);
          for (const addon of snapshot.addOns)
            expect(
              shop.links.some(
                (link) =>
                  link.productId === item.productId &&
                  link.addOnId === addon.id,
              ),
            ).toBe(true);
        }
        const total = lines.reduce(
          (sum, line) => sum.plus(line.lineTotalSnapshot as string),
          new Prisma.Decimal(0),
        );
        expect(total.equals(order.totalPrice as string)).toBe(true);
        if (order.paymentStatus === 'PAID') {
          expect(cashiers.has(order.paidBy!)).toBe(true);
          expect(
            new Prisma.Decimal(order.amountReceived as string)
              .minus(order.changeDue as string)
              .equals(total),
          ).toBe(true);
        }
      }
      for (const timeline of shop.timelines) {
        if (timeline.target === 'COMPLETED')
          expect(timeline.completedAt.getTime()).toBeLessThanOrEqual(
            now.getTime(),
          );
        if (timeline.target === 'PREPARING')
          expect(timeline.startedAt.getTime()).toBeLessThanOrEqual(
            now.getTime(),
          );
        if (timeline.target === 'READY')
          expect(timeline.readyAt.getTime()).toBeLessThanOrEqual(now.getTime());
        expect(timeline.startedAt.getTime()).toBeLessThan(
          timeline.readyAt.getTime(),
        );
        expect(timeline.readyAt.getTime()).toBeLessThan(
          timeline.completedAt.getTime(),
        );
      }
      expect(shop.timelines.filter((t) => t.target === 'QUEUED')).toHaveLength(
        3,
      );
      expect(
        shop.timelines.filter((t) => t.target === 'PREPARING'),
      ).toHaveLength(2);
      expect(shop.timelines.filter((t) => t.target === 'READY')).toHaveLength(
        2,
      );
    }
  });
  it('covers every menu product with a specific prompt and tenant-owned storage path', () => {
    for (const entry of plan.manifest) {
      expect(entry.storagePath).toMatch(
        new RegExp(
          `^shops/${entry.shopId}/products/${entry.productId}/[a-f0-9-]+\\.webp$`,
        ),
      );
      expect(entry.prompt).toContain(entry.productName);
      expect(entry.prompt.length).toBeGreaterThan(300);
      expect(entry.fallbackUrl).toBe(`/demo-assets/${entry.kind}.svg`);
    }
  });
});
