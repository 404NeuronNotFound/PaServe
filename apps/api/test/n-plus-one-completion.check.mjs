// Completes the N+1 acceptance matrix inside the existing disposable PG fixture.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CashPaymentService } from '../dist/modules/orders/cash-payment.service.js';
import { OrderQrService } from '../dist/modules/orders/order-qr.service.js';
import { OrderTokenService } from '../dist/modules/orders/order-token.service.js';
import { CompletedSalesService } from '../dist/modules/orders/completed-sales.service.js';
import { ConfigService } from '@nestjs/config';

export async function completeNPlusOne({
  prisma,
  setup,
  actor,
  large,
  empty,
  pricing,
  productService,
  menuController,
  res,
  active,
  lines,
  checkoutSamples,
  measured,
  queryMeasurements,
  check,
  seed,
}) {
  const cash = new CashPaymentService(
    prisma,
    new OrderQrService(prisma, new OrderTokenService(new ConfigService())),
  );
  const sales = new CompletedSalesService(prisma);
  const sameCount = (name) => {
    const samples = queryMeasurements.filter((sample) => sample.name === name);
    assert.ok(samples.length > 1 && samples[0].selects > 0);
    assert.equal(
      new Set(samples.map((sample) => sample.selects)).size,
      1,
      `${name}: per-request query growth`,
    );
  };
  await check(
    'real payment review, settlement and receipt queries stay constant at 1/10/100 lines',
    async () => {
      for (const order of checkoutSamples) {
        const size = order.items.length;
        const review = await measured('payment pending review', size, () =>
          cash.review(actor, large.id, order.id, prisma, true),
        );
        assert.equal(review.order.items.length, size);
        const paid = await measured('payment settlement', size, () =>
          cash.create(actor, large.id, order.id, {
            requestId: randomUUID(),
            method: 'CASH',
            orderNumber: order.orderNumber,
            reviewVersion: review.order.reviewVersion,
            amountReceived: order.totalPrice,
          }),
        );
        assert.equal(paid.payment.amountReceived, order.totalPrice);
        assert.equal(paid.payment.changeDue, '0.00');
        const receipt = await measured('payment paid receipt', size, () =>
          cash.review(actor, large.id, order.id),
        );
        assert.equal(receipt.order.items.length, size);
        assert.equal(receipt.order.totalPrice, order.totalPrice);
      }
      for (const name of [
        'payment pending review',
        'payment settlement',
        'payment paid receipt',
      ])
        sameCount(name);
    },
  );

  // Seed actual valid immutable snapshots, and execute each permitted workflow
  // transition with every constraint/trigger installed. No trigger is disabled.
  const source = checkoutSamples[0];
  const reset = {
    status: 'PENDING_CONFIRMATION',
    paymentStatus: 'UNPAID',
    paymentMethod: null,
    paymentRequestId: null,
    paymentReviewVersion: null,
    paymentReference: null,
    paymentDescription: null,
    amountReceived: null,
    changeDue: null,
    paidAt: null,
    paidBy: null,
    preparationStatus: null,
    queuedAt: null,
    preparationStartedAt: null,
    preparationStartedBy: null,
    preparationReadyAt: null,
    preparationReadyBy: null,
    completedAt: null,
    completedBy: null,
    decidedAt: null,
    decidedBy: null,
    rejectionReason: null,
    qrTokenRevokedAt: null,
    receiptAccessRevokedAt: null,
  };
  const paidIds = [];
  const growCompleted = async (from, to) => {
    const added = (
      await setup.query(
        `INSERT INTO orders SELECT cloned.* FROM orders source
      CROSS JOIN generate_series($3::int,$4::int) n
      CROSS JOIN LATERAL jsonb_populate_record(NULL::orders,to_jsonb(source)||$5::jsonb||jsonb_build_object(
        'id',gen_random_uuid()::text,'requestId',gen_random_uuid()::text,'orderNumber','ORD-'||(900000+n),
        'qrTokenNonce',gen_random_uuid()::text,'createdAt','2026-01-01T00:00:00','updatedAt','2026-01-01T00:00:00')) cloned
      WHERE source.id=$1 AND source."shopId"=$2 RETURNING id`,
        [source.id, large.id, from, to, JSON.stringify(reset)],
      )
    ).rows.map((row) => row.id);
    assert.equal(added.length, to - from + 1);
    await setup.query(
      `INSERT INTO order_items SELECT cloned.* FROM order_items source
      CROSS JOIN unnest($3::text[]) target_id
      CROSS JOIN LATERAL jsonb_populate_record(NULL::order_items,to_jsonb(source)||jsonb_build_object(
        'id',gen_random_uuid()::text,'orderId',target_id,'createdAt','2026-01-01T00:00:00')) cloned
      WHERE source."orderId"=$1 AND source."shopId"=$2`,
      [source.id, large.id, added],
    );
    await setup.query(
      `UPDATE orders SET status='CONFIRMED',"decidedAt"=timestamp '2026-06-15',"decidedBy"=$3,"qrTokenRevokedAt"=timestamp '2026-06-15',
      "paymentStatus"='PAID',"paymentMethod"='CASH',"paymentRequestId"=gen_random_uuid()::text,"paymentReviewVersion"=repeat('a',64),
      "amountReceived"="totalPrice","changeDue"=0,"paidAt"=timestamp '2026-06-15',"paidBy"=$3,"preparationStatus"='QUEUED',"queuedAt"=timestamp '2026-06-15'
      WHERE "shopId"=$1 AND id=ANY($2::text[])`,
      [large.id, added, actor],
    );
    await setup.query(
      `UPDATE orders SET "preparationStatus"='PREPARING',"preparationStartedAt"=timestamp '2026-06-15',"preparationStartedBy"=$3
      WHERE "shopId"=$1 AND id=ANY($2::text[])`,
      [large.id, added, actor],
    );
    await setup.query(
      `UPDATE orders SET "preparationStatus"='READY',"preparationReadyAt"=timestamp '2026-06-15',"preparationReadyBy"=$3
      WHERE "shopId"=$1 AND id=ANY($2::text[])`,
      [large.id, added, actor],
    );
    await setup.query(
      `UPDATE orders SET "preparationStatus"='COMPLETED',"completedAt"=timestamp '2026-06-15',"completedBy"=$3
      WHERE "shopId"=$1 AND id=ANY($2::text[])`,
      [large.id, added, actor],
    );
    paidIds.push(...added);
  };
  await check(
    'dashboard and paid-order lookups keep fixed query budgets over 1/10/100/500 completed records',
    async () => {
      let previous = 0;
      for (const size of [1, 10, 100, 500]) {
        await growCompleted(previous + 1, size);
        previous = size;
        const report = await measured('dashboard sales report', size, () =>
          sales.custom(actor, large.id, '2026-06-15', '2026-06-15'),
        );
        assert.equal(report.completedOrders, size);
        assert.equal(report.itemsSold, size);
        assert.equal(report.totalSales, (11 * size).toFixed(2));
        assert.equal(report.recentOrders.length, Math.min(size, 10));
        const daily = await measured('dashboard daily analytics', size, () =>
          sales.dailyAnalytics(actor, large.id, '2026-06-15', '2026-06-15'),
        );
        assert.equal(daily.completedOrders, size);
        assert.equal(daily.itemsSold, size);
        const hourly = await measured('dashboard hourly analytics', size, () =>
          sales.peakHours(actor, large.id, '2026-06-15', '2026-06-15'),
        );
        assert.equal(hourly.completedOrders, size);
        assert.equal(hourly.hours.length, 24);
        const top = await measured('dashboard top products', size, () =>
          sales.topProducts(
            actor,
            large.id,
            '2026-06-15',
            '2026-06-15',
            'QUANTITY',
          ),
        );
        assert.equal(top.products.length, 1);
        assert.equal(top.products[0].quantity, size);
        const payment = await measured(
          'payment lookup over paid dataset',
          size,
          () => cash.review(actor, large.id, paidIds.at(-1)),
        );
        assert.equal(payment.order.items.length, 1);
        assert.equal(payment.payment.amountReceived, '11.00');
      }
      for (const name of [
        'dashboard sales report',
        'dashboard daily analytics',
        'dashboard hourly analytics',
        'dashboard top products',
        'payment lookup over paid dataset',
      ])
        sameCount(name);
    },
  );

  await check(
    '500 catalog and menu records traverse bounded pages with fixed per-page budgets',
    async () => {
      for (const size of [1, 10, 100, 500]) {
        const before = queryMeasurements.length;
        await measured('management traversal total', size, async () => {
          let remaining = size,
            cursor;
          const ids = new Set();
          while (remaining) {
            const page = await productService.list(actor, large.id, {
              limit: String(Math.min(remaining, 100)),
              cursor,
            });
            assert.ok(page.products.length > 0 && page.products.length <= 100);
            for (const product of page.products) {
              assert.ok(!ids.has(product.id));
              ids.add(product.id);
            }
            remaining -= page.products.length;
            cursor = page.nextCursor;
            assert.ok(!remaining || cursor);
          }
          assert.equal(ids.size, size);
        });
        assert.ok(
          queryMeasurements[before].selects <= 5 * Math.ceil(size / 100),
        );
        const menuStart = queryMeasurements.length;
        await measured('public menu traversal total', size, async () => {
          let remaining = size,
            productsCursor,
            categoriesCursor;
          const ids = new Set();
          while (remaining) {
            const page = await menuController.read(large.slug, res, {
              limit: String(Math.min(remaining, 100)),
              productsCursor,
              categoriesCursor,
            });
            assert.ok(page.products.length > 0 && page.products.length <= 100);
            for (const product of page.products) {
              assert.ok(!ids.has(product.id));
              ids.add(product.id);
            }
            remaining -= page.products.length;
            productsCursor = page.nextProductsCursor;
            categoriesCursor = page.nextCategoriesCursor ?? 'end';
            assert.ok(!remaining || productsCursor);
          }
          assert.equal(ids.size, size);
        });
        assert.ok(
          queryMeasurements[menuStart].selects <= 4 * Math.ceil(size / 100),
        );
      }
    },
  );
  await check(
    '500 quote records use bounded batches and oversized single requests do no database work',
    async () => {
      const identities = await prisma.product.findMany({
        where: { shopId: large.id },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 500,
      });
      const configured = new Map(lines.map((line) => [line.productId, line]));
      const input = identities.map(
        ({ id }) =>
          configured.get(id) ?? {
            productId: id,
            quantity: 1,
            variantIds: [],
            addOnIds: [],
          },
      );
      const quotes = await measured(
        '500 quotes in bounded batches',
        500,
        async () => {
          const result = [];
          for (let i = 0; i < input.length; i += 100)
            result.push(
              ...(await pricing.quoteMany(
                large.slug,
                input.slice(i, i + 100),
                prisma,
              )),
            );
          return result;
        },
      );
      assert.equal(quotes.length, 500);
      assert.deepEqual(
        quotes.map((q) => q.productId),
        input.map((line) => line.productId),
      );
      assert.ok(queryMeasurements.at(-1).selects <= 30);
      await measured('oversized 500-line quote rejected', 500, () =>
        assert.rejects(pricing.quoteMany(large.slug, input, prisma), {
          status: 400,
        }),
      );
      assert.equal(queryMeasurements.at(-1).selects, 0);
    },
  );
  await check(
    '500 order-feed rows retain a fixed read budget per chronological page',
    async () => {
      await seed(empty, 251, 5000, 0);
      for (const size of [100, 500]) {
        await measured('order feed traversal total', size, async () => {
          let cursor;
          const ids = new Set();
          while (ids.size < size) {
            const page = await active.list(actor, empty.id, cursor);
            assert.ok(page.orders.length > 0 && page.orders.length <= 25);
            for (const order of page.orders) {
              assert.equal(order.shopId, empty.id);
              assert.ok(!ids.has(order.id));
              ids.add(order.id);
            }
            cursor = page.nextCursor;
            assert.ok(ids.size >= size || cursor);
          }
          assert.equal(ids.size, size);
        });
        assert.equal(
          queryMeasurements.at(-1).selects,
          4 * Math.ceil(size / 25),
        );
      }
    },
  );
  return {
    completionPass: true,
    matrixSizes: [1, 10, 100, 500],
    completedDashboardRecords: 500,
    semantics:
      'Counts include WITH/SELECT statements. Payment 500 measures a single-resource review over a 500-record paid dataset; payment line counts remain capped at 100. Catalog/feed/quote 500 cases traverse bounded pages/batches. Total traversal queries scale with pages, not per-row enrichment.',
  };
}
