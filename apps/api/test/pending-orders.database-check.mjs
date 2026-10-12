// Run after the API build and migration deploy, from apps/api.
// Exercise the configured schema with real services; all fixtures roll back.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/database/prisma.service.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { OrdersService } from '../dist/modules/orders/orders.service.js';
import { OrderTokenService } from '../dist/modules/orders/order-token.service.js';
import { PublicProductRepository } from '../dist/modules/products/public-product.repository.js';
import { PublicProductService } from '../dist/modules/products/public-product.service.js';
import { TableContextService } from '../dist/modules/tables/table-context.service.js';

const prisma = new PrismaService();
const slug = `pending-check-${randomUUID()}`;
const rollback = new Error('Intentional pending-order fixture rollback');
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const [column] = await tx.$queryRaw`
          SELECT column_default FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'orders'
            AND column_name = 'status'`;
        assert.equal(column.column_default, "'PENDING_CONFIRMATION'::text");
        const [constraint] = await tx.$queryRaw`
          SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
          WHERE conrelid = 'orders'::regclass AND conname = 'orders_status_check'`;
        assert.match(
          constraint.definition,
          /status = 'PENDING_CONFIRMATION'::text/,
        );
        for (const name of ['orders', 'order_items']) {
          const [security] = await tx.$queryRaw`
            SELECT relrowsecurity AS rls,
              has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
              has_table_privilege('authenticated', oid, 'SELECT,INSERT,UPDATE,DELETE') AS browser_access
            FROM pg_class WHERE oid = ${name}::regclass`;
          assert.deepEqual(security, {
            rls: true,
            anon_access: false,
            browser_access: false,
          });
        }
        const shop = await tx.shop.create({
          data: { name: 'Pending check', slug },
        });
        const product = await tx.product.create({
          data: {
            shopId: shop.id,
            name: 'Coffee',
            slug: 'coffee',
            price: '10.01',
          },
        });
        const table = await tx.restaurantTable.create({
          data: { shopId: shop.id, number: 'Patio 1', code: 'T1' },
        });
        const config = new ConfigService();
        const contexts = new TableContextService(config);
        const tokens = new OrderTokenService(config);
        const orders = new OrdersService(
          { $transaction: (callback) => callback(tx) },
          new PublicProductService(new PublicProductRepository(tx)),
          contexts,
          tokens,
        );
        for (const mode of ['TAKEOUT', 'DINE_IN']) {
          const request = {
            mode,
            requestId: randomUUID(),
            items: [
              {
                productId: product.id,
                quantity: 2,
                variantIds: [],
                addOnIds: [],
              },
            ],
            ...(mode === 'DINE_IN'
              ? {
                  tableCode: table.code,
                  tableToken: contexts.issue(slug, table.code),
                }
              : {}),
          };
          const created = await orders.create(slug, request);
          const saved = await tx.order.findUniqueOrThrow({
            where: { id: created.order.id },
          });
          assert.equal(saved.status, 'PENDING_CONFIRMATION');
          assert.equal(saved.paymentStatus, 'UNPAID');
          assert.equal(saved.tableId, mode === 'DINE_IN' ? table.id : null);
          assert.equal(created.order.status, saved.status);
          assert.equal(created.order.totalPrice, '20.02');
          assert.equal(
            await tx.orderItem.count({
              where: { shopId: shop.id, orderId: saved.id },
            }),
            1,
          );
          tokens.verify(created.order.qrToken, saved);
          const replay = await orders.create(slug, request);
          assert.deepEqual(replay, created);
        }
        assert.equal(await tx.order.count({ where: { shopId: shop.id } }), 2);
        assert.equal(
          (await tx.shop.findUniqueOrThrow({ where: { id: shop.id } }))
            .lastOrderNumber,
          2n,
        );
        throw rollback;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 60000,
      },
    ),
    (error) => error === rollback,
  );
  assert.equal(await prisma.shop.count({ where: { slug } }), 0);
  console.log(
    'Configured database verified: PENDING_CONFIRMATION/UNPAID dine-in and takeout creation, saved lines/prices, QR credentials, stable replay, numbering, SQL default/constraint and RLS. All fixtures rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
