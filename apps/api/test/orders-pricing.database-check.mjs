import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, Prisma } from '../dist/generated/prisma/client.js';
import { PublicProductRepository } from '../dist/modules/products/public-product.repository.js';
import { PublicProductService } from '../dist/modules/products/public-product.service.js';
import { OrdersService } from '../dist/modules/orders/orders.service.js';
import { TableContextService } from '../dist/modules/tables/table-context.service.js';

// Real Prisma repository + real pricing/order services; all DDL/data rolls back.
const schema = `phase10_pricing_${randomUUID().replaceAll('-', '')}`;
const q = (name) => `"${schema}"."${name}"`;
const prisma = new PrismaClient({
  adapter: new PrismaPg(
    { connectionString: process.env.DATABASE_URL },
    { schema },
  ),
});
const rollback = new Error('Intentional Phase 10 pricing rollback');
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        for (const name of [
          'shops',
          'categories',
          'products',
          'product_option_groups',
          'product_variants',
          'add_ons',
          'product_add_ons',
        ]) {
          await tx.$executeRawUnsafe(
            `CREATE TABLE ${q(name)} (LIKE public."${name}" INCLUDING ALL)`,
          );
        }
        await tx.$executeRawUnsafe(
          `CREATE TABLE ${q('restaurant_tables')} (LIKE public.restaurant_tables INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`,
        );
        // Support both pre-rollout and already-upgraded source schemas.
        await tx.$executeRawUnsafe(
          `ALTER TABLE ${q('shops')} DROP COLUMN IF EXISTS "acceptingOrders"`,
        );
        await tx.$executeRawUnsafe(
          `ALTER TABLE ${q('restaurant_tables')} ADD PRIMARY KEY ("id")`,
        );
        await tx.$executeRawUnsafe(
          `CREATE TYPE ${q('ProductStatus')} AS ENUM ('AVAILABLE', 'SOLD_OUT', 'HIDDEN')`,
        );
        await tx.$executeRawUnsafe(
          `ALTER TABLE ${q('products')} ALTER COLUMN "status" DROP DEFAULT`,
        );
        await tx.$executeRawUnsafe(
          `ALTER TABLE ${q('products')} ALTER COLUMN "status" TYPE ${q('ProductStatus')} USING "status"::text::${q('ProductStatus')}`,
        );
        await tx.$executeRawUnsafe(
          `ALTER TABLE ${q('products')} ALTER COLUMN "status" SET DEFAULT 'AVAILABLE'`,
        );
        await tx.$executeRawUnsafe(
          `CREATE TYPE ${q('MenuLayout')} AS ENUM ('grid', 'list', 'compact')`,
        );
        await tx.$executeRawUnsafe(
          `ALTER TABLE ${q('shops')} ALTER COLUMN "menuLayout" DROP DEFAULT`,
        );
        await tx.$executeRawUnsafe(
          `ALTER TABLE ${q('shops')} ALTER COLUMN "menuLayout" TYPE ${q('MenuLayout')} USING "menuLayout"::text::${q('MenuLayout')}`,
        );
        await tx.$executeRawUnsafe(
          `ALTER TABLE ${q('shops')} ALTER COLUMN "menuLayout" SET DEFAULT 'list'`,
        );
        for (const migration of [
          '20261012090000_dine_in_orders',
          '20261012140000_takeout_mode',
          '20261012140100_takeout_order_tables',
          '20261012160000_pending_order_status',
          '20261012170000_shop_accepting_orders',
        ]) {
          const sql = await readFile(
            new URL(
              `../prisma/migrations/${migration}/migration.sql`,
              import.meta.url,
            ),
            'utf8',
          );
          for (const statement of sql
            .replace(/^--.*$/gm, '')
            .split(';')
            .map((value) => value.trim())
            .filter(Boolean)) {
            await tx.$executeRawUnsafe(
              statement.replace(
                /"(orders|shops|restaurant_tables|OrderMode)"/g,
                (_match, name) => q(name),
              ),
            );
          }
        }
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        const shop = await tx.shop.create({
          data: { name: 'Phase 10 fixture', slug: 'phase10-cafe' },
        });
        assert.equal(shop.acceptingOrders, true);
        const foreignShop = await tx.shop.create({
          data: { name: 'Foreign fixture', slug: 'phase10-other' },
        });
        const category = await tx.category.create({
          data: { shopId: shop.id, name: 'Coffee', slug: 'coffee' },
        });
        const product = await tx.product.create({
          data: {
            shopId: shop.id,
            categoryId: category.id,
            name: 'Coffee',
            slug: 'coffee',
            price: '120.01',
          },
        });
        const foreignProduct = await tx.product.create({
          data: {
            shopId: foreignShop.id,
            name: 'Other coffee',
            slug: 'other-coffee',
            price: '1.00',
          },
        });
        const group = await tx.productOptionGroup.create({
          data: { shopId: shop.id, productId: product.id, name: 'Size' },
        });
        const variant = await tx.productVariant.create({
          data: {
            shopId: shop.id,
            productId: product.id,
            optionGroupId: group.id,
            name: 'Large',
            priceAdjustment: '30.10',
          },
        });
        const milk = await tx.addOn.create({
          data: { shopId: shop.id, name: 'Oat milk', priceAdjustment: '25.20' },
        });
        await tx.productAddOn.create({
          data: { shopId: shop.id, productId: product.id, addOnId: milk.id },
        });
        const table = await tx.restaurantTable.create({
          data: { shopId: shop.id, number: '12', code: 'T12' },
        });
        const pricing = new PublicProductService(
          new PublicProductRepository(tx),
        );
        const contexts = new TableContextService(new ConfigService());
        const orders = new OrdersService(
          { $transaction: (callback) => callback(tx) },
          pricing,
          contexts,
        );
        const items = [
          {
            productId: product.id,
            variantIds: [variant.id],
            addOnIds: [milk.id],
            quantity: 2,
            notes: 'Less ice\nNo sugar',
          },
        ];
        assert.equal(
          (await pricing.quote(shop.slug, product.id, items[0], tx)).totalPrice,
          '350.62',
        );
        await tx.product.update({
          where: { id: product.id },
          data: { price: '150.03' },
        });
        await tx.productVariant.update({
          where: { id: variant.id },
          data: { priceAdjustment: '35.07' },
        });
        await tx.addOn.update({
          where: { id: milk.id },
          data: { priceAdjustment: '26.15' },
        });
        const pickupRequest = {
          requestId: randomUUID(),
          mode: 'TAKEOUT',
          items,
        };
        const pickup = await orders.create(shop.slug, pickupRequest);
        assert.equal(pickup.order.status, 'PENDING');
        assert.equal(pickup.order.totalPrice, '422.50');
        assert.equal(pickup.order.table, null);
        const saved = await tx.order.findUniqueOrThrow({
          where: { id: pickup.order.id },
        });
        assert.equal(saved.totalPrice.toFixed(2), '422.50');
        assert.equal(saved.items[0].unitPrice, '211.25');
        assert.equal(saved.items[0].notes, 'Less ice\nNo sugar');
        const dineIn = await orders.create(shop.slug, {
          requestId: randomUUID(),
          mode: 'DINE_IN',
          tableCode: table.code,
          tableToken: contexts.issue(shop.slug, table.code),
          items,
        });
        assert.equal(dineIn.order.status, 'PENDING');
        assert.equal(dineIn.order.totalPrice, '422.50');
        assert.equal(
          (await tx.order.findUniqueOrThrow({ where: { id: dineIn.order.id } }))
            .tableId,
          table.id,
        );
        // Repeated product IDs are separate configured lines, not missing products.
        const repeated = await orders.create(shop.slug, {
          ...pickupRequest,
          requestId: randomUUID(),
          items: [
            items[0],
            { ...items[0], quantity: 1, notes: 'Separate cup' },
          ],
        });
        assert.equal(repeated.order.items.length, 2);
        assert.equal(repeated.order.totalPrice, '633.75');
        assert.equal(repeated.order.items[1].notes, 'Separate cup');
        const availableProduct = await tx.product.create({
          data: {
            shopId: shop.id,
            name: 'Still available',
            slug: 'still-available',
            price: '10.00',
          },
        });
        const availableLine = {
          productId: availableProduct.id,
          quantity: 1,
          variantIds: [],
          addOnIds: [],
        };
        const availabilityCount = await tx.order.count();
        for (const state of [
          { status: 'SOLD_OUT', isArchived: false },
          { status: 'HIDDEN', isArchived: false },
          { status: 'AVAILABLE', isArchived: true },
        ]) {
          // A successful preview is intentionally stale by the next submission.
          assert.equal(
            (await pricing.quote(shop.slug, product.id, items[0], tx))
              .totalPrice,
            '422.50',
          );
          await tx.product.update({
            where: { id: product.id, shopId: shop.id },
            data: state,
          });
          for (const mode of ['DINE_IN', 'TAKEOUT']) {
            for (const lines of [
              [items[0]],
              [availableLine, items[0]],
              [items[0], availableLine],
            ]) {
              await assert.rejects(
                () =>
                  orders.create(shop.slug, {
                    ...pickupRequest,
                    requestId: randomUUID(),
                    mode,
                    items: lines,
                    ...(mode === 'DINE_IN'
                      ? {
                          tableCode: table.code,
                          tableToken: contexts.issue(shop.slug, table.code),
                        }
                      : {}),
                  }),
                (error) =>
                  error.status === 404 &&
                  error.getResponse().code === 'PRODUCT_NOT_AVAILABLE',
              );
              assert.equal(await tx.order.count(), availabilityCount);
            }
          }
          assert.equal(
            (await orders.create(shop.slug, pickupRequest)).order.id,
            pickup.order.id,
          );
          await tx.product.update({
            where: { id: product.id, shopId: shop.id },
            data: { status: 'AVAILABLE', isArchived: false },
          });
        }
        const restored = await orders.create(shop.slug, {
          ...pickupRequest,
          requestId: randomUUID(),
        });
        assert.equal(restored.order.status, 'PENDING');
        assert.equal(restored.order.totalPrice, '422.50');
        const before = await tx.order.count();
        const missingProductId = randomUUID();
        for (const mode of ['DINE_IN', 'TAKEOUT']) {
          for (const productId of [missingProductId, foreignProduct.id]) {
            for (const lines of [
              [{ ...items[0], productId }],
              [items[0], { ...items[0], productId }],
              [{ ...items[0], productId }, items[0]],
            ]) {
              await assert.rejects(
                () =>
                  orders.create(shop.slug, {
                    ...pickupRequest,
                    requestId: randomUUID(),
                    mode,
                    items: lines,
                    ...(mode === 'DINE_IN'
                      ? {
                          tableCode: table.code,
                          tableToken: contexts.issue(shop.slug, table.code),
                        }
                      : {}),
                  }),
                (error) =>
                  error.status === 404 &&
                  error.getResponse().code === 'PRODUCT_NOT_AVAILABLE',
              );
              assert.equal(await tx.order.count(), before);
            }
          }
        }
        await tx.shop.update({
          where: { id: shop.id },
          data: { acceptingOrders: false },
        });
        for (const mode of ['DINE_IN', 'TAKEOUT']) {
          await assert.rejects(
            () =>
              orders.create(shop.slug, {
                ...pickupRequest,
                requestId: randomUUID(),
                mode,
                ...(mode === 'DINE_IN'
                  ? {
                      tableCode: table.code,
                      tableToken: contexts.issue(shop.slug, table.code),
                    }
                  : {}),
              }),
            (error) => error.getResponse().code === 'SHOP_NOT_ACCEPTING_ORDERS',
          );
        }
        assert.equal(await tx.order.count(), before);
        assert.equal(
          (await orders.create(shop.slug, pickupRequest)).order.id,
          pickup.order.id,
        );
        assert.equal(
          (await pricing.quote(shop.slug, product.id, items[0], tx)).totalPrice,
          '422.50',
        );
        await tx.shop.update({
          where: { id: shop.id },
          data: { acceptingOrders: true },
        });
        const rejected = async (changedItems) => {
          await assert.rejects(() =>
            orders.create(shop.slug, {
              requestId: randomUUID(),
              mode: 'TAKEOUT',
              items: changedItems,
            }),
          );
          assert.equal(await tx.order.count(), before);
        };
        await rejected([{ ...items[0], productId: foreignProduct.id }]);
        await rejected([{ ...items[0], variantIds: [] }]);
        await rejected([
          items[0],
          { ...items[0], productId: foreignProduct.id },
        ]);
        await tx.addOn.update({
          where: { id: milk.id },
          data: { isAvailable: false },
        });
        await rejected(items);
        await tx.addOn.update({
          where: { id: milk.id },
          data: { isAvailable: true },
        });
        await tx.product.update({
          where: { id: product.id },
          data: { status: 'SOLD_OUT' },
        });
        await rejected(items);
        await tx.product.update({
          where: { id: product.id },
          data: { status: 'AVAILABLE' },
        });
        await tx.productVariant.update({
          where: { id: variant.id },
          data: { isAvailable: false },
        });
        await rejected(items);
        await tx.productVariant.update({
          where: { id: variant.id },
          data: { isAvailable: true },
        });
        await tx.productOptionGroup.update({
          where: { id: group.id },
          data: { isAvailable: false },
        });
        await rejected(items);
        await tx.productOptionGroup.update({
          where: { id: group.id },
          data: { isAvailable: true },
        });
        await tx.product.update({
          where: { id: product.id },
          data: { isArchived: true },
        });
        await rejected(items);
        await tx.product.update({
          where: { id: product.id },
          data: { isArchived: false, status: 'HIDDEN' },
        });
        await rejected(items);
        await tx.product.update({
          where: { id: product.id },
          data: { status: 'AVAILABLE' },
        });
        await tx.category.update({
          where: { id: category.id },
          data: { isVisible: false },
        });
        await rejected(items);
        await tx.shop.update({
          where: { id: shop.id },
          data: { isActive: false },
        });
        assert.equal(
          (await orders.create(shop.slug, pickupRequest)).order.id,
          pickup.order.id,
        );
        await rejected(items);
        const protection =
          await tx.$queryRaw`SELECT relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${schema} AND c.relname = 'orders'`;
        assert.equal(protection[0].rls, true);
        throw rollback;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 60000,
      },
    ),
    (error) => error === rollback,
  );
  const [leftover] =
    await prisma.$queryRaw`SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = ${schema}`;
  assert.equal(leftover.count, 0);
  console.log(
    'Real Prisma/PostgreSQL order pricing passed: current base and modifier prices, exact totals, pending persistence, dine-in/takeout binding, invalid and partially invalid orders, inactive options/products/categories/shops, paused intake with menu quotes available, replay after pause/deactivation and RLS. All schema/data changes rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
