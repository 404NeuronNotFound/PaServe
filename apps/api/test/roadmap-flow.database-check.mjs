// Run from apps/api after building. Real Nest HTTP + PostgreSQL workflow.
// A single outer transaction contains every fixture and intentionally rolls back.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { configureRequestBody } from '../dist/common/http/request-body.js';

const prisma = new PrismaService();
const marker = randomUUID();
const email = `flow-audit-${marker}@example.invalid`;
const rollback = new Error('Intentional HTTP workflow fixture rollback');
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        // Nested repository transactions use the same real, rollback-only fixture transaction.
        // Independent committed-session concurrency is covered by orders-concurrency.
        const database = new Proxy(tx, {
          get(target, key) {
            if (key === '$transaction') return (callback) => callback(tx);
            // The outer fixture runner owns the connection and disconnects after rollback.
            if (key === 'onModuleDestroy') return async () => {};
            return Reflect.get(target, key);
          },
        });
        const module = await Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(PrismaService)
          .useValue(database)
          .compile();
        const app = module.createNestApplication();
        configureRequestBody(app);
        app.setGlobalPrefix('api/v1');
        await app.init();
        const http = (method, path, token) => {
          const call = request(app.getHttpServer())[method](`/api/v1${path}`);
          return token ? call.set('Authorization', `Bearer ${token}`) : call;
        };
        try {
          const credentials = {
            email,
            password: 'Real workflow audit fixture passphrase',
          };
          const registered = await http('post', '/auth/register')
            .send(credentials)
            .expect(201);
          const login = await http('post', '/auth/login')
            .set('X-PaServe-Client', 'web')
            .send(credentials)
            .expect(200);
          const token = login.body.accessToken;
          const userId = registered.body.user.id;
          const shop = (
            await http('post', '/shops', token)
              .send({ name: `Audit cafe ${marker}` })
              .expect(201)
          ).body.shop;
          const base = `/shops/${shop.id}`;
          await http('patch', base, token)
            .send({ displayName: 'Audit public cafe' })
            .expect(200);
          const category = (
            await http('post', `${base}/categories`, token)
              .send({ name: 'Coffee' })
              .expect(201)
          ).body.category;
          const product = (
            await http('post', `${base}/products`, token)
              .send({ name: 'Latte', categoryId: category.id, price: '120.01' })
              .expect(201)
          ).body.product;
          const productPath = `${base}/products/${product.id}`;
          const group = (
            await http('post', `${productPath}/option-groups`, token)
              .send({ name: 'Size', isRequired: true })
              .expect(201)
          ).body.optionGroup;
          const variant = (
            await http('post', `${productPath}/variants`, token)
              .send({
                name: 'Large',
                optionGroupId: group.id,
                priceAdjustment: '30.10',
              })
              .expect(201)
          ).body.variant;
          const addOn = (
            await http('post', `${base}/add-ons`, token)
              .send({ name: 'Oat milk', priceAdjustment: '25.20' })
              .expect(201)
          ).body.addOn;
          await http('post', `${productPath}/add-ons`, token)
            .send({ addOnId: addOn.id })
            .expect(201);
          const table = (
            await http('post', `${base}/tables`, token)
              .send({ number: 'Patio 1' })
              .expect(201)
          ).body.table;
          const menu = await http(
            'get',
            `/menu/${shop.slug}/table/${table.code}`,
          ).expect(200);
          assert.equal(menu.body.shop.name, shop.name);
          const settings = await http('get', `${base}/settings`, token).expect(
            200,
          );
          assert.equal(settings.body.shop.displayName, 'Audit public cafe');
          const selection = {
            productId: product.id,
            variantIds: [variant.id],
            addOnIds: [addOn.id],
            quantity: 2,
            notes: '<b>Less ice</b>',
          };
          const { productId, ...quoteInput } = selection;
          const quote = await http(
            'post',
            `/menu/${shop.slug}/products/${productId}/quote`,
          )
            .send(quoteInput)
            .expect(201);
          assert.equal(quote.body.totalPrice, '350.62');
          const orderPath = `/menu/${shop.slug}/orders`;
          const body = {
            requestId: randomUUID(),
            mode: 'DINE_IN',
            tableCode: table.code,
            tableToken: menu.body.table.checkoutToken,
            items: [selection],
          };
          await http('post', orderPath)
            .send({ ...body, status: 'PAID' })
            .expect(400);
          await http('post', orderPath)
            .send({ ...body, items: [{ ...selection, unitPrice: '0.01' }] })
            .expect(400);
          const created = (await http('post', orderPath).send(body).expect(201))
            .body;
          assert.equal(created.order.status, 'PENDING_CONFIRMATION');
          assert.equal(created.order.paymentStatus, 'UNPAID');
          assert.equal(created.order.totalPrice, '350.62');
          assert.equal(created.order.items[0].notes, selection.notes);
          assert.deepEqual(
            (await http('post', orderPath).send(body).expect(201)).body,
            created,
          );
          await http('post', orderPath)
            .send({ ...body, items: [{ ...selection, quantity: 3 }] })
            .expect(409);
          const verification = await http(
            'post',
            `${base}/orders/${created.order.id}/verify-qr`,
            token,
          )
            .send({ qrToken: created.order.qrToken })
            .expect(200);
          assert.equal(verification.body.order.status, 'PENDING_CONFIRMATION');
          assert.equal(verification.body.order.paymentStatus, 'UNPAID');
          await http('get', `${base}/settings`).expect(401);
          const foreignShop = await tx.shop.create({
            data: { name: 'Foreign cafe', slug: `foreign-${marker}` },
          });
          await http('get', `/shops/${foreignShop.id}/settings`, token).expect(
            404,
          );
          await http(
            'patch',
            `/shops/${foreignShop.id}/products/${product.id}`,
            token,
          )
            .send({ price: '0.01' })
            .expect(404);
          await tx.shopMember.update({
            where: { userId_shopId: { userId, shopId: shop.id } },
            data: { role: 'KITCHEN' },
          });
          await http('get', `${base}/settings`, token).expect(403);
          await http(
            'post',
            `${base}/orders/${created.order.id}/verify-qr`,
            token,
          )
            .send({ qrToken: created.order.qrToken })
            .expect(403);
          await tx.shopMember.update({
            where: { userId_shopId: { userId, shopId: shop.id } },
            data: { role: 'OWNER' },
          });
          await http('patch', base, token)
            .send({ acceptingOrders: false })
            .expect(200);
          assert.deepEqual(
            (await http('post', orderPath).send(body).expect(201)).body,
            created,
          );
          await http('post', orderPath)
            .send({ ...body, requestId: randomUUID() })
            .expect(409);
          await http('patch', base, token)
            .send({ acceptingOrders: true })
            .expect(200);
          const pickup = (
            await http('post', orderPath)
              .send({
                requestId: randomUUID(),
                mode: 'TAKEOUT',
                items: [selection],
              })
              .expect(201)
          ).body;
          assert.equal(pickup.order.table, null);
          assert.equal(await tx.order.count({ where: { shopId: shop.id } }), 2);
          assert.equal(
            await tx.orderItem.count({ where: { shopId: shop.id } }),
            2,
          );
          const cookie = login.headers['set-cookie'][0].split(';')[0];
          await http('post', '/auth/logout')
            .set('X-PaServe-Client', 'web')
            .set('Cookie', cookie)
            .send({})
            .expect(204);
          await http('get', `${base}/settings`, token).expect(401);
          throw rollback;
        } finally {
          await app.close();
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 120000,
      },
    ),
    (error) => error === rollback,
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  console.log(
    'Real HTTP/PostgreSQL roadmap flow passed: registration/login, OWNER shop/settings, catalog/modifiers, table context, exact quotes, dine-in/takeout PENDING_CONFIRMATION/UNPAID orders, snapshots, QR, replay/tampering, foreign-shop and changed-role denial, paused intake and logout. All fixtures rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
