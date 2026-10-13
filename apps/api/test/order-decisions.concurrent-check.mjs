import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { OrderTokenService } from '../dist/modules/orders/order-token.service.js';
import { OrderQrService } from '../dist/modules/orders/order-qr.service.js';
import { OrderDecisionService } from '../dist/modules/orders/order-decision.service.js';

// Real competing service transactions use only this disposable schema. Public
// tables and migration history remain untouched; close sessions before removal.
const schema = `order_decision_check_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^order_decision_check_[0-9a-f]{32}$/);
const setup = new pg.Client({ connectionString: process.env.DATABASE_URL });
let created = false;
let prisma;
try {
  await setup.connect();
  await setup.query('BEGIN');
  await setup.query(`CREATE SCHEMA "${schema}"`);
  await setup.query(`CREATE TYPE "${schema}"."MenuLayout" AS ENUM ('grid', 'list', 'compact')`);
  await setup.query(`CREATE TYPE "${schema}"."ShopRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN')`);
  await setup.query(`CREATE TYPE "${schema}"."OrderMode" AS ENUM ('DINE_IN', 'TAKEOUT')`);
  for (const table of ['users', 'shops', 'shop_members', 'orders', 'order_items']) {
    await setup.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
  }
  await setup.query(`ALTER TABLE "${schema}".shops ALTER COLUMN "menuLayout" DROP DEFAULT, ALTER COLUMN "menuLayout" TYPE "${schema}"."MenuLayout" USING "menuLayout"::text::"${schema}"."MenuLayout", ALTER COLUMN "menuLayout" SET DEFAULT 'list'::"${schema}"."MenuLayout"`);
  await setup.query(`ALTER TABLE "${schema}".shop_members ALTER COLUMN role TYPE "${schema}"."ShopRole" USING role::text::"${schema}"."ShopRole"`);
  await setup.query(`ALTER TABLE "${schema}".orders ALTER COLUMN mode DROP DEFAULT, ALTER COLUMN mode TYPE "${schema}"."OrderMode" USING mode::text::"${schema}"."OrderMode", ALTER COLUMN mode SET DEFAULT 'DINE_IN'::"${schema}"."OrderMode"`);
  await setup.query(`SET LOCAL search_path TO "${schema}", public`);
  const columns = await setup.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'orders' AND column_name = 'decidedAt'`, [schema]);
  if (!columns.rowCount) {
    const sql = await readFile(new URL('../prisma/migrations/20261013140000_cashier_order_decisions/migration.sql', import.meta.url), 'utf8');
    await setup.query(sql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ''));
  }
  await setup.query('COMMIT');
  created = true;
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 4, options: `-c search_path=${schema},public` }, { schema }) });
  const tokens = new OrderTokenService(new ConfigService({ JWT_ACCESS_SECRET: 'order-decision-race-test-secret-at-least-32-characters' }));
  const qr = new OrderQrService(prisma, tokens);
  const decisions = new OrderDecisionService(prisma, qr);
  const users = await Promise.all([1, 2].map(n => prisma.user.create({ data: { email: `race-${n}@example.com`, passwordHash: 'unused' } })));
  const shop = await prisma.shop.create({ data: { name: 'Race check', slug: 'race-check' } });
  for (const user of users) await prisma.shopMember.create({ data: { userId: user.id, shopId: shop.id, role: 'CASHIER' } });
  const quote = { productId: randomUUID(), productName: 'Saved coffee', currency: 'PHP', quantity: 1, basePrice: '10.00', unitPrice: '10.00', totalPrice: '10.00', variants: [], addOns: [] };
  const order = await prisma.order.create({ data: { shopId: shop.id, requestId: randomUUID(), requestHash: 'a'.repeat(64), mode: 'TAKEOUT', orderNumber: 'ORD-000001', totalPrice: '10.00', items: [quote], ...tokens.metadata() } });
  await prisma.orderItem.create({ data: { shopId: shop.id, orderId: order.id, lineNumber: 1, quantity: 1, snapshot: quote, productSnapshotId: quote.productId, productNameSnapshot: quote.productName, basePriceSnapshot: '10.00', unitPriceSnapshot: '10.00', lineTotalSnapshot: '10.00', variantsSnapshot: [], addOnsSnapshot: [] } });
  const token = tokens.issue(order);
  const { reviewVersion } = (await qr.scan(users[0].id, shop.id, token)).order;
  const dto = { qrToken: token, reviewVersion };
  const results = await Promise.allSettled([
    decisions.decide(users[0].id, shop.id, order.id, 'CONFIRMED', dto),
    decisions.decide(users[1].id, shop.id, order.id, 'REJECTED', { ...dto, rejectionReason: 'Competing decision' }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const loser = results.find(result => result.status === 'rejected');
  assert.ok([403, 409].includes(loser.reason.status));
  const winner = results.find(result => result.status === 'fulfilled').value.order;
  const saved = await prisma.order.findFirst({ where: { id: order.id, shopId: shop.id } });
  assert.equal(saved.status, winner.status);
  assert.equal(saved.decidedBy, winner.decidedBy);
  assert.equal(saved.paymentStatus, 'UNPAID');
  assert.ok(saved.decidedAt instanceof Date && saved.qrTokenRevokedAt instanceof Date);
  await assert.rejects(decisions.decide(users[0].id, shop.id, order.id, 'CONFIRMED', dto), { status: 403 });
  console.log('Passed: concurrent confirm/reject commits exactly one decision, preserves unpaid payment and consumes the token.');
} finally {
  if (prisma) await prisma.$disconnect();
  if (created) {
    await setup.query(`DROP SCHEMA "${schema}" CASCADE`);
    const remaining = await setup.query('SELECT 1 FROM information_schema.schemata WHERE schema_name = $1', [schema]);
    assert.equal(remaining.rowCount, 0);
    console.log('Removed isolated order-decision test schema.');
  } else await setup.query('ROLLBACK').catch(() => {});
  await setup.end();
}
