import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/database/prisma.service.js';
import { OrderQrService } from '../dist/modules/orders/order-qr.service.js';
import { OrderTokenService } from '../dist/modules/orders/order-token.service.js';

// Every fixture and menu edit remains inside one rollback-only transaction.
const prisma = new PrismaService();
const slug = `cashier-read-${randomUUID()}`;
const rollback = new Error('Intentional cashier-read fixture rollback');
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
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
        const token = tokens.issue(order);
        const initial = await cashier.scan(user.id, shop.id, token);
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
    'Passed: real saved receipt loading, menu edit/deletion stability, shop isolation, role revocation and fixture rollback.',
  );
} finally {
  await prisma.$disconnect();
}
