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
import { OrderTokenService } from '../dist/modules/orders/order-token.service.js';
import { OrderQrService } from '../dist/modules/orders/order-qr.service.js';

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
          'users',
          'shop_members',
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
          `ALTER TABLE ${q('shops')} DROP COLUMN IF EXISTS "lastOrderNumber"`,
        );
        await tx.$executeRawUnsafe(
          `ALTER TABLE ${q('restaurant_tables')} ADD PRIMARY KEY ("id")`,
        );
        await tx.$executeRawUnsafe(
          `CREATE TYPE ${q('ProductStatus')} AS ENUM ('AVAILABLE', 'SOLD_OUT', 'HIDDEN')`,
        );
        await tx.$executeRawUnsafe(
          `CREATE TYPE ${q('ShopRole')} AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN')`,
        );
        await tx.$executeRawUnsafe(
          `ALTER TABLE ${q('shop_members')} ALTER COLUMN "role" TYPE ${q('ShopRole')} USING "role"::text::${q('ShopRole')}`,
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
          '20261012180000_parent_order_metadata',
          '20261012190000_order_items',
          '20261012200000_order_price_snapshots',
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
                /"(order_items|products|orders|shops|restaurant_tables|OrderMode)"/g,
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
          new OrderTokenService(new ConfigService()),
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
        assert.equal(pickup.order.subtotalPrice, '422.50');
        assert.equal(pickup.order.table, null);
        const saved = await tx.order.findUniqueOrThrow({
          where: { id: pickup.order.id },
        });
        assert.equal(saved.totalPrice.toFixed(2), '422.50');
        assert.equal(saved.orderNumber, 'ORD-000001');
        assert.equal(saved.paymentStatus, 'UNPAID');
        assert.equal(saved.createdAt.getTime(), saved.updatedAt.getTime());
        assert.ok(saved.qrTokenExpiresAt.getTime() > saved.createdAt.getTime());
        const tokenService = new OrderTokenService(new ConfigService());
        tokenService.verify(pickup.order.qrToken, saved);
        // Exercise the actual persisted QR lookup, including live authorization.
        const cashier = await tx.user.create({
          data: {
            email: 'phase11-cashier@example.invalid',
            passwordHash: 'fixture-only',
          },
        });
        const member = await tx.shopMember.create({
          data: { userId: cashier.id, shopId: shop.id, role: 'CASHIER' },
        });
        await tx.shopMember.create({
          data: { userId: cashier.id, shopId: foreignShop.id, role: 'CASHIER' },
        });
        const qr = new OrderQrService(tx, tokenService);
        const verifyQr = () =>
          qr.verify(cashier.id, shop.id, saved.id, pickup.order.qrToken);
        for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']) {
          await tx.shopMember.update({
            where: { id: member.id },
            data: { role },
          });
          const result = await verifyQr();
          assert.equal(result.verified, true);
          assert.equal(result.order.orderNumber, saved.orderNumber);
          assert.equal(result.order.totalPrice, '422.50');
          assert.equal('qrToken' in result.order, false);
          assert.equal('qrTokenNonce' in result.order, false);
        }
        await tx.shopMember.update({
          where: { id: member.id },
          data: { role: 'KITCHEN' },
        });
        await assert.rejects(verifyQr(), (error) => error.getStatus() === 404);
        await tx.shopMember.update({
          where: { id: member.id },
          data: { role: 'CASHIER' },
        });
        await assert.rejects(
          qr.verify(cashier.id, foreignShop.id, saved.id, pickup.order.qrToken),
          (error) => error.getStatus() === 404,
        );
        await tx.user.update({
          where: { id: cashier.id },
          data: { isActive: false },
        });
        await assert.rejects(verifyQr(), (error) => error.getStatus() === 404);
        await tx.user.update({
          where: { id: cashier.id },
          data: { isActive: true },
        });
        await tx.shop.update({
          where: { id: shop.id },
          data: { isActive: false },
        });
        await assert.rejects(verifyQr(), (error) => error.getStatus() === 404);
        await tx.shop.update({
          where: { id: shop.id },
          data: { isActive: true },
        });
        for (const token of [
          'ORD-000001',
          saved.id,
          `${pickup.order.qrToken}x`,
        ]) {
          await assert.rejects(
            qr.verify(cashier.id, shop.id, saved.id, token),
            (error) => error.getStatus() === 403,
          );
        }
        await tx.order.update({
          where: { id: saved.id },
          data: { qrTokenRevokedAt: new Date() },
        });
        await assert.rejects(verifyQr(), (error) => error.getStatus() === 403);
        await tx.order.update({
          where: { id: saved.id },
          data: { qrTokenRevokedAt: null },
        });
        await tx.order.update({
          where: { id: saved.id },
          data: { qrTokenExpiresAt: new Date(Date.now() - 1) },
        });
        await assert.rejects(verifyQr(), (error) => error.getStatus() === 403);
        await tx.order.update({
          where: { id: saved.id },
          data: {
            qrTokenExpiresAt: saved.qrTokenExpiresAt,
            updatedAt: saved.updatedAt,
          },
        });
        await tx.shopMember.delete({ where: { id: member.id } });
        await assert.rejects(verifyQr(), (error) => error.getStatus() === 404);
        assert.equal(
          (await orders.create(shop.slug, pickupRequest)).order.qrToken,
          pickup.order.qrToken,
        );
        assert.equal(saved.items[0].unitPrice, '211.25');
        assert.equal(saved.items[0].notes, 'Less ice\nNo sugar');
        const persistedItems = await tx.orderItem.findMany({
          where: { shopId: shop.id, orderId: saved.id },
          orderBy: { lineNumber: 'asc' },
        });
        assert.equal(persistedItems.length, 1);
        assert.equal(persistedItems[0].productId, product.id);
        assert.equal(persistedItems[0].quantity, 2);
        assert.deepEqual(persistedItems[0].snapshot, saved.items[0]);
        const dineIn = await orders.create(shop.slug, {
          requestId: randomUUID(),
          mode: 'DINE_IN',
          tableCode: table.code,
          tableToken: contexts.issue(shop.slug, table.code),
          items,
        });
        assert.equal(dineIn.order.status, 'PENDING');
        assert.equal(dineIn.order.orderNumber, 'ORD-000002');
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
        assert.equal(repeated.order.subtotalPrice, '633.75');
        assert.equal(repeated.order.items[1].notes, 'Separate cup');
        const separateLines = await tx.orderItem.findMany({
          where: { shopId: shop.id, orderId: repeated.order.id },
          orderBy: { lineNumber: 'asc' },
        });
        assert.deepEqual(
          separateLines.map((line) => [line.lineNumber, line.quantity]),
          [
            [1, 2],
            [2, 1],
          ],
        );
        assert.equal(separateLines[1].notes, 'Separate cup');
        const replayLineCount = await tx.orderItem.count({
          where: { shopId: shop.id },
        });
        await orders.create(shop.slug, pickupRequest);
        assert.equal(
          await tx.orderItem.count({ where: { shopId: shop.id } }),
          replayLineCount,
        );
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
        const historicalProduct = await tx.product.create({
          data: {
            shopId: shop.id,
            name: 'Historical product',
            slug: 'historical-product',
            price: '1.00',
          },
        });
        const historicalRequest = {
          ...pickupRequest,
          requestId: randomUUID(),
          items: [
            {
              productId: historicalProduct.id,
              quantity: 1,
              variantIds: [],
              addOnIds: [],
            },
          ],
        };
        const historicalOrder = await orders.create(
          shop.slug,
          historicalRequest,
        );
        await tx.product.delete({
          where: { id: historicalProduct.id, shopId: shop.id },
        });
        const historicalLine = await tx.orderItem.findFirstOrThrow({
          where: { orderId: historicalOrder.order.id, shopId: shop.id },
        });
        assert.equal(historicalLine.productId, null);
        assert.equal(historicalLine.shopId, shop.id);
        assert.equal(historicalLine.snapshot.productId, historicalProduct.id);
        assert.deepEqual(
          (await orders.create(shop.slug, historicalRequest)).order.items,
          historicalOrder.order.items,
        );
        const before = await tx.order.count();
        // A failed child insert must undo the already-inserted parent and counter.
        const itemCountBefore = await tx.orderItem.count({
          where: { shopId: shop.id },
        });
        const counterBefore = (
          await tx.shop.findUniqueOrThrow({ where: { id: shop.id } })
        ).lastOrderNumber;
        let reachedItemInsert = false;
        const brokenTx = {
          $queryRaw: tx.$queryRaw.bind(tx),
          shop: tx.shop,
          product: tx.product,
          order: tx.order,
          orderItem: {
            findMany: (args) => tx.orderItem.findMany(args),
            createMany: async ({ data }) => {
              reachedItemInsert = true;
              return tx.orderItem.createMany({
                data: data.map((row, index) =>
                  index === 0 ? { ...row, quantity: 100 } : row,
                ),
              });
            },
          },
        };
        const failingOrders = new OrdersService(
          {
            $transaction: async (callback) => {
              // A savepoint models the per-order transaction inside the outer rollback fixture.
              await tx.$executeRawUnsafe('SAVEPOINT failed_order_items');
              try {
                return await callback(brokenTx);
              } catch (error) {
                await tx.$executeRawUnsafe(
                  'ROLLBACK TO SAVEPOINT failed_order_items',
                );
                throw error;
              } finally {
                await tx.$executeRawUnsafe(
                  'RELEASE SAVEPOINT failed_order_items',
                );
              }
            },
          },
          pricing,
          contexts,
          new OrderTokenService(new ConfigService()),
        );
        await assert.rejects(() =>
          failingOrders.create(shop.slug, {
            ...pickupRequest,
            requestId: randomUUID(),
            items: [items[0], { ...items[0], quantity: 1 }],
          }),
        );
        assert.equal(reachedItemInsert, true);
        assert.equal(await tx.order.count(), before);
        assert.equal(
          await tx.orderItem.count({ where: { shopId: shop.id } }),
          itemCountBefore,
        );
        assert.equal(
          (await tx.shop.findUniqueOrThrow({ where: { id: shop.id } }))
            .lastOrderNumber,
          counterBefore,
        );
        for (const override of [
          { shopId: foreignShop.id, productId: null },
          {
            productId: foreignProduct.id,
            productSnapshotId: foreignProduct.id,
            snapshot: { ...saved.items[0], productId: foreignProduct.id },
          },
          { lineNumber: 1 },
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT invalid_order_item');
          await assert.rejects(() =>
            tx.orderItem.createMany({
              data: [
                {
                  ...persistedItems[0],
                  lineNumber: 2,
                  id: randomUUID(),
                  ...override,
                },
              ],
            }),
          );
          await tx.$executeRawUnsafe(
            'ROLLBACK TO SAVEPOINT invalid_order_item',
          );
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_order_item');
        }
        const unassignedAddOn = await tx.addOn.create({
          data: {
            shopId: shop.id,
            name: 'Unassigned extra',
            priceAdjustment: '1.00',
          },
        });
        const otherProductAddOn = await tx.addOn.create({
          data: {
            shopId: shop.id,
            name: 'Other product extra',
            priceAdjustment: '1.00',
          },
        });
        await tx.productAddOn.create({
          data: {
            shopId: shop.id,
            productId: availableProduct.id,
            addOnId: otherProductAddOn.id,
          },
        });
        const foreignAddOn = await tx.addOn.create({
          data: {
            shopId: foreignShop.id,
            name: 'Foreign extra',
            priceAdjustment: '1.00',
          },
        });
        await tx.productAddOn.create({
          data: {
            shopId: foreignShop.id,
            productId: foreignProduct.id,
            addOnId: foreignAddOn.id,
          },
        });
        const rejectAddOns = async (mode, addOnIds, mixed = false) => {
          const invalidLine = { ...items[0], addOnIds };
          await assert.rejects(
            () =>
              orders.create(shop.slug, {
                ...pickupRequest,
                requestId: randomUUID(),
                mode,
                items: mixed ? [items[0], invalidLine] : [invalidLine],
                ...(mode === 'DINE_IN'
                  ? {
                      tableCode: table.code,
                      tableToken: contexts.issue(shop.slug, table.code),
                    }
                  : {}),
              }),
            (error) =>
              error.status === 400 &&
              error.getResponse().code === 'PRODUCT_SELECTION_INVALID',
          );
          assert.equal(await tx.order.count(), before);
        };
        for (const mode of ['DINE_IN', 'TAKEOUT']) {
          for (const addOnIds of [
            [randomUUID()],
            [unassignedAddOn.id],
            [otherProductAddOn.id],
            [foreignAddOn.id],
            [milk.id, milk.id],
          ])
            await rejectAddOns(mode, addOnIds);
          await rejectAddOns(mode, [unassignedAddOn.id], true);
        }
        for (const state of ['disabled', 'detached']) {
          await pricing.quote(shop.slug, product.id, items[0], tx);
          if (state === 'disabled')
            await tx.addOn.update({
              where: { id: milk.id, shopId: shop.id },
              data: { isAvailable: false },
            });
          else
            await tx.productAddOn.deleteMany({
              where: {
                shopId: shop.id,
                productId: product.id,
                addOnId: milk.id,
              },
            });
          for (const mode of ['DINE_IN', 'TAKEOUT'])
            await rejectAddOns(mode, [milk.id]);
          assert.equal(
            (await orders.create(shop.slug, pickupRequest)).order.id,
            pickup.order.id,
          );
          if (state === 'disabled')
            await tx.addOn.update({
              where: { id: milk.id, shopId: shop.id },
              data: { isAvailable: true },
            });
          else
            await tx.productAddOn.create({
              data: {
                shopId: shop.id,
                productId: product.id,
                addOnId: milk.id,
              },
            });
        }
        const otherProductVariant = await tx.productVariant.create({
          data: {
            shopId: shop.id,
            productId: availableProduct.id,
            name: 'Other product choice',
            priceAdjustment: '1.00',
          },
        });
        const foreignVariant = await tx.productVariant.create({
          data: {
            shopId: foreignShop.id,
            productId: foreignProduct.id,
            name: 'Foreign choice',
            priceAdjustment: '1.00',
          },
        });
        const conflictingVariant = await tx.productVariant.create({
          data: {
            shopId: shop.id,
            productId: product.id,
            optionGroupId: group.id,
            name: 'Another size',
            priceAdjustment: '2.00',
          },
        });
        const rejectVariants = async (mode, variantIds, mixed = false) => {
          const invalidLine = { ...items[0], variantIds };
          await assert.rejects(
            () =>
              orders.create(shop.slug, {
                ...pickupRequest,
                requestId: randomUUID(),
                mode,
                items: mixed ? [items[0], invalidLine] : [invalidLine],
                ...(mode === 'DINE_IN'
                  ? {
                      tableCode: table.code,
                      tableToken: contexts.issue(shop.slug, table.code),
                    }
                  : {}),
              }),
            (error) =>
              error.status === 400 &&
              error.getResponse().code === 'PRODUCT_SELECTION_INVALID',
          );
          assert.equal(await tx.order.count(), before);
        };
        const deletedVariant = await tx.productVariant.create({
          data: {
            shopId: shop.id,
            productId: product.id,
            optionGroupId: group.id,
            name: 'Deleted size',
            priceAdjustment: '2.00',
          },
        });
        await pricing.quote(
          shop.slug,
          product.id,
          { ...items[0], variantIds: [deletedVariant.id] },
          tx,
        );
        await tx.productVariant.delete({
          where: { id: deletedVariant.id, shopId: shop.id },
        });
        for (const mode of ['DINE_IN', 'TAKEOUT']) {
          for (const variantIds of [
            [randomUUID()],
            [deletedVariant.id],
            [otherProductVariant.id],
            [foreignVariant.id],
            [variant.id, conflictingVariant.id],
            [variant.id, variant.id],
            [],
          ])
            await rejectVariants(mode, variantIds);
          await rejectVariants(mode, [otherProductVariant.id], true);
        }
        for (const [delegate, choiceId] of [
          [tx.productVariant, variant.id],
          [tx.productOptionGroup, group.id],
        ]) {
          // Preview succeeds before the selected variant/group is disabled.
          await pricing.quote(shop.slug, product.id, items[0], tx);
          await delegate.update({
            where: { id: choiceId, shopId: shop.id },
            data: { isAvailable: false },
          });
          for (const mode of ['DINE_IN', 'TAKEOUT'])
            await rejectVariants(mode, [variant.id]);
          assert.equal(
            (await orders.create(shop.slug, pickupRequest)).order.id,
            pickup.order.id,
          );
          await delegate.update({
            where: { id: choiceId, shopId: shop.id },
            data: { isAvailable: true },
          });
        }
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
        const receiptBeforeMenuEdits = await orders.create(
          shop.slug,
          pickupRequest,
        );
        const linesBeforeMenuEdits = await tx.orderItem.findMany({
          where: { shopId: shop.id, orderId: pickup.order.id },
          orderBy: { lineNumber: 'asc' },
        });
        assert.equal(linesBeforeMenuEdits[0].productNameSnapshot, 'Coffee');
        assert.equal(
          linesBeforeMenuEdits[0].basePriceSnapshot.toFixed(2),
          '150.03',
        );
        assert.equal(linesBeforeMenuEdits[0].variantsSnapshot[0].name, 'Large');
        assert.equal(
          linesBeforeMenuEdits[0].addOnsSnapshot[0].name,
          'Oat milk',
        );
        await tx.product.update({
          where: { id: product.id, shopId: shop.id },
          data: { name: 'Renamed coffee', price: '999.99' },
        });
        await tx.productVariant.update({
          where: { id: variant.id, shopId: shop.id },
          data: { name: 'Renamed size', priceAdjustment: '88.88' },
        });
        await tx.addOn.update({
          where: { id: milk.id, shopId: shop.id },
          data: { name: 'Renamed modifier', priceAdjustment: '77.77' },
        });
        assert.deepEqual(
          (await orders.create(shop.slug, pickupRequest)).order,
          receiptBeforeMenuEdits.order,
        );
        assert.deepEqual(
          await tx.orderItem.findMany({
            where: { shopId: shop.id, orderId: pickup.order.id },
            orderBy: { lineNumber: 'asc' },
          }),
          linesBeforeMenuEdits,
        );
        await tx.productAddOn.deleteMany({
          where: { shopId: shop.id, productId: product.id, addOnId: milk.id },
        });
        await tx.productVariant.delete({
          where: { id: variant.id, shopId: shop.id },
        });
        await tx.addOn.delete({ where: { id: milk.id, shopId: shop.id } });
        await tx.product.delete({ where: { id: product.id, shopId: shop.id } });
        assert.deepEqual(
          (await orders.create(shop.slug, pickupRequest)).order,
          receiptBeforeMenuEdits.order,
        );
        const preserved = await tx.orderItem.findFirstOrThrow({
          where: { shopId: shop.id, orderId: pickup.order.id },
        });
        assert.equal(preserved.productId, null);
        assert.equal(preserved.productSnapshotId, product.id);
        assert.deepEqual(preserved.snapshot, linesBeforeMenuEdits[0].snapshot);
        assert.equal(
          (await orders.create(shop.slug, pickupRequest)).order.id,
          pickup.order.id,
        );
        await rejected(items);
        const protection =
          await tx.$queryRaw`SELECT relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${schema} AND c.relname = 'orders'`;
        assert.equal(protection[0].rls, true);
        assert.equal(
          (await tx.shop.findUniqueOrThrow({ where: { id: shop.id } }))
            .lastOrderNumber,
          BigInt(before),
        );
        throw rollback;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        // One rollback-only fixture runs many independent Phase 10/11 submissions.
        timeout: 120000,
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
