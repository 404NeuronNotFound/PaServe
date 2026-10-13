import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/database/prisma.service.js';
import { OrderQrService } from '../dist/modules/orders/order-qr.service.js';
import { OrderTokenService } from '../dist/modules/orders/order-token.service.js';
import { OrderDecisionService } from '../dist/modules/orders/order-decision.service.js';
import { OrdersService } from '../dist/modules/orders/orders.service.js';
import { readFile } from 'node:fs/promises';

// Every fixture and menu edit remains inside one rollback-only transaction.
const prisma = new PrismaService();
const slug = `cashier-decisions-${randomUUID()}`;
const rollback = new Error('Intentional cashier-read fixture rollback');
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        // Test the additive migration inside the fixture transaction when pending.
        // DDL and all decisions roll back together; deployment is a separate step.
        const columns =
          await tx.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'decidedAt'`;
        if (!columns.length) {
          const migration = await readFile(
            new URL(
              '../prisma/migrations/20261013140000_cashier_order_decisions/migration.sql',
              import.meta.url,
            ),
            'utf8',
          );
          for (const statement of migration
            .replace(/^--.*$/gm, '')
            .split(';')
            .map((part) => part.trim())
            .filter((part) => part && part !== 'BEGIN' && part !== 'COMMIT'))
            await tx.$executeRawUnsafe(statement);
        }
        const user = await tx.user.create({
          data: {
            email: `${slug}@example.com`,
            passwordHash: 'unused-test-hash',
          },
        });
        const shop = await tx.shop.create({
          data: { name: 'Cashier read check', slug },
        });
        await tx.shopMember.create({
          data: { userId: user.id, shopId: shop.id, role: 'CASHIER' },
        });
        const product = await tx.product.create({
          data: {
            shopId: shop.id,
            name: 'Saved Latte',
            slug: 'latte',
            price: '50.00',
          },
        });
        const tokens = new OrderTokenService(
          new ConfigService({
            JWT_ACCESS_SECRET:
              'cashier-read-test-secret-at-least-32-characters',
          }),
        );
        const quote = {
          productId: product.id,
          productName: 'Saved Latte',
          currency: 'PHP',
          quantity: 2,
          notes: 'Less ice.\nNo lid.',
          basePrice: '50.00',
          unitPrice: '67.75',
          totalPrice: '135.50',
          variants: [
            {
              id: randomUUID(),
              name: 'Large',
              optionGroupId: randomUUID(),
              isDefault: false,
              priceAdjustment: '10.00',
            },
          ],
          addOns: [
            { id: randomUUID(), name: 'Oat milk', priceAdjustment: '7.75' },
          ],
        };
        const order = await tx.order.create({
          data: {
            shopId: shop.id,
            requestId: randomUUID(),
            requestHash: 'a'.repeat(64),
            mode: 'TAKEOUT',
            orderNumber: 'ORD-000001',
            totalPrice: '135.50',
            items: [quote],
            ...tokens.metadata(),
          },
        });
        await tx.orderItem.create({
          data: {
            shopId: shop.id,
            orderId: order.id,
            productId: product.id,
            lineNumber: 1,
            quantity: quote.quantity,
            notes: quote.notes,
            snapshot: quote,
            productSnapshotId: product.id,
            productNameSnapshot: quote.productName,
            basePriceSnapshot: quote.basePrice,
            unitPriceSnapshot: quote.unitPrice,
            lineTotalSnapshot: quote.totalPrice,
            variantsSnapshot: quote.variants,
            addOnsSnapshot: quote.addOns,
          },
        });
        const cashier = new OrderQrService(tx, tokens);
        const originalRequest = {
          requestId: order.requestId,
          mode: 'TAKEOUT',
          items: [
            {
              productId: product.id,
              quantity: quote.quantity,
              variantIds: quote.variants.map((option) => option.id),
              addOnIds: quote.addOns.map((option) => option.id),
              notes: quote.notes,
            },
          ],
        };
        const requestHash = createHash('sha256')
          .update(
            JSON.stringify({
              mode: originalRequest.mode,
              items: originalRequest.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                variantIds: [...item.variantIds].sort(),
                addOnIds: [...item.addOnIds].sort(),
                notes: item.notes,
              })),
            }),
          )
          .digest('hex');
        await tx.order.updateMany({
          where: { id: order.id, shopId: shop.id },
          data: { requestHash },
        });
        const token = tokens.issue(order);
        const initial = await cashier.scan(user.id, shop.id, token);
        assert.deepEqual(
          await cashier.lookupNumber(user.id, shop.id, order.orderNumber),
          initial,
        );
        assert.deepEqual(initial.order.items, [quote]);
        assert.equal(initial.order.totalPrice, '135.50');
        await tx.product.update({
          where: { id: product.id },
          data: { name: 'New menu name', price: '999.00' },
        });
        assert.deepEqual(
          (await cashier.scan(user.id, shop.id, token)).order,
          initial.order,
        );
        await tx.product.delete({ where: { id: product.id } });
        assert.deepEqual(
          (await cashier.scan(user.id, shop.id, token)).order,
          initial.order,
        );
        const other = await tx.shop.create({
          data: { name: 'Other cashier shop', slug: `${slug}-other` },
        });
        await tx.shopMember.create({
          data: { userId: user.id, shopId: other.id, role: 'CASHIER' },
        });
        await assert.rejects(cashier.scan(user.id, other.id, token), {
          status: 403,
        });
        await assert.rejects(
          cashier.verify(user.id, other.id, order.id, token),
          { status: 404 },
        );
        const decisions = new OrderDecisionService(
          { $transaction: (work) => work(tx) },
          cashier,
        );
        const dto = {
          qrToken: token,
          reviewVersion: initial.order.reviewVersion,
        };
        await assert.rejects(
          decisions.decide(user.id, other.id, order.id, 'REJECTED', dto),
          { status: 404 },
        );
        await assert.rejects(
          decisions.decide(user.id, shop.id, order.id, 'REJECTED', {
            ...dto,
            reviewVersion: 'b'.repeat(64),
          }),
          { status: 409 },
        );
        const decided = await decisions.decide(
          user.id,
          shop.id,
          order.id,
          'REJECTED',
          dto,
        );
        assert.equal(decided.order.status, 'REJECTED');
        assert.equal(decided.order.paymentStatus, 'UNPAID');
        assert.equal(decided.order.decidedBy, user.id);
        const saved = await tx.order.findFirst({
          where: { id: order.id, shopId: shop.id },
        });
        assert.equal(saved.status, 'REJECTED');
        assert.equal(saved.paymentStatus, 'UNPAID');
        const checkout = new OrdersService(
          { $transaction: (work) => work(tx) },
          undefined,
          undefined,
          tokens,
        );
        await assert.rejects(
          checkout.create(slug, originalRequest),
          (error) =>
            error.status === 409 &&
            error.getResponse().code === 'ORDER_ALREADY_PROCESSED',
        );
        assert.ok(saved.qrTokenRevokedAt instanceof Date);
        assert.ok(saved.decidedAt instanceof Date);
        await assert.rejects(cashier.scan(user.id, shop.id, token), {
          status: 403,
        });
        await assert.rejects(
          decisions.decide(user.id, shop.id, order.id, 'REJECTED', dto),
          { status: 403 },
        );
        assert.deepEqual(
          await tx.order.findFirst({
            where: { id: order.id, shopId: shop.id },
          }),
          saved,
        );
        await assert.rejects(
          decisions.decide(user.id, shop.id, order.id, 'REJECTED', dto),
          { status: 403 },
        );
        const rejectedOrder = await tx.order.create({
          data: {
            shopId: shop.id,
            requestId: randomUUID(),
            requestHash: 'c'.repeat(64),
            mode: 'TAKEOUT',
            orderNumber: 'ORD-000002',
            totalPrice: '135.50',
            items: [quote],
            ...tokens.metadata(),
          },
        });
        await tx.orderItem.create({
          data: {
            shopId: shop.id,
            orderId: rejectedOrder.id,
            lineNumber: 1,
            quantity: quote.quantity,
            notes: quote.notes,
            snapshot: quote,
            productSnapshotId: product.id,
            productNameSnapshot: quote.productName,
            basePriceSnapshot: quote.basePrice,
            unitPriceSnapshot: quote.unitPrice,
            lineTotalSnapshot: quote.totalPrice,
            variantsSnapshot: quote.variants,
            addOnsSnapshot: quote.addOns,
          },
        });
        const rejectedToken = tokens.issue(rejectedOrder);
        await tx.order.updateMany({
          where: { id: rejectedOrder.id, shopId: shop.id },
          data: { qrTokenExpiresAt: new Date(0) },
        });
        await assert.rejects(cashier.scan(user.id, shop.id, rejectedToken), {
          status: 403,
        });
        const rejectedReview = await cashier.lookupNumber(
          user.id,
          shop.id,
          rejectedOrder.orderNumber,
        );
        const rejection = await decisions.decide(
          user.id,
          shop.id,
          rejectedOrder.id,
          'REJECTED',
          {
            orderNumber: rejectedOrder.orderNumber,
            reviewVersion: rejectedReview.order.reviewVersion,
            rejectionReason: 'Customer cancelled.',
          },
        );
        assert.equal(rejection.order.status, 'REJECTED');
        assert.equal(rejection.order.paymentStatus, 'UNPAID');
        assert.equal(rejection.order.rejectionReason, 'Customer cancelled.');
        await assert.rejects(
          decisions.decide(user.id, shop.id, rejectedOrder.id, 'REJECTED', {
            orderNumber: rejectedOrder.orderNumber,
            reviewVersion: rejectedReview.order.reviewVersion,
          }),
          { status: 409 },
        );
        await tx.shopMember.update({
          where: { userId_shopId: { userId: user.id, shopId: shop.id } },
          data: { role: 'KITCHEN' },
        });
        await assert.rejects(cashier.scan(user.id, shop.id, token), {
          status: 404,
        });
        throw rollback;
      },
      { timeout: 90000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(
    await prisma.shop.count({ where: { slug: { startsWith: slug } } }),
    0,
  );
  assert.equal(
    await prisma.user.count({ where: { email: `${slug}@example.com` } }),
    0,
  );
  console.log(
    'Passed: QR/manual lookup and decisions, expired-QR fallback, unchanged payment, metadata, token consumption, stale review and shop isolation; fixtures rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
