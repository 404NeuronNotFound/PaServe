import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { TablesRepository } from '../dist/modules/tables/tables.repository.js';
import { TablesService } from '../dist/modules/tables/tables.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { TenantResourcesRepository } from '../dist/modules/tenancy/tenant-resources.repository.js';

const prisma = new PrismaService();
const rollback = new Error('Intentional table fixture rollback');
const email = `tables-${randomUUID()}@example.com`;
try {
  const [protection] = await prisma.$queryRaw`
    SELECT c.relrowsecurity AS rls,
      has_table_privilege('anon', 'public.restaurant_tables', 'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
      has_table_privilege('authenticated', 'public.restaurant_tables', 'SELECT,INSERT,UPDATE,DELETE') AS browser_access
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'restaurant_tables' AND n.nspname = 'public'
  `;
  assert.equal(protection.rls, true);
  assert.equal(protection.anon_access, false);
  assert.equal(protection.browser_access, false);
  await assert.rejects(prisma.$transaction(async tx => {
    const user = await tx.user.create({ data: { email, passwordHash: 'unused' } });
    const a = await tx.shop.create({ data: { name: 'Table fixture A', slug: `tables-${randomUUID()}`, members: { create: { userId: user.id, role: 'OWNER' } } } });
    const b = await tx.shop.create({ data: { name: 'Table fixture B', slug: `tables-${randomUUID()}`, members: { create: { userId: user.id, role: 'ADMIN' } } } });
    const repository = new TablesRepository(tx);
    const service = new TablesService(repository, new ShopMembersService(new ShopMembersRepository(tx)));
    const one = (await service.create(user.id, a.id, { number: '12' })).table;
    const two = (await service.create(user.id, b.id, { number: '12' })).table;
    assert.notEqual(one.id, two.id);
    assert.equal(one.shopId, a.id); assert.equal(two.shopId, b.id);
    assert.equal(one.code, 'T12'); assert.equal(one.isActive, true);
    assert.equal((await tx.restaurantTable.findUniqueOrThrow({ where: { id: one.id } })).number, '12');
    await service.create(user.id, a.id, { number: '1' });
    await service.create(user.id, a.id, { number: '9999' });
    assert.deepEqual((await service.list(user.id, a.id)).tables.map(t => t.number), ['1', '12', '9999']);
    assert.deepEqual((await service.list(user.id, b.id)).tables.map(t => t.id), [two.id]);
    const resources = new TenantResourcesRepository(tx);
    assert.equal(await resources.findResource(user.id, a.id, 'table', two.id), null);

    // PostgreSQL errors abort the transaction: isolate expected denials with savepoints.
    async function deny(operation, predicate) {
      await tx.$executeRaw`SAVEPOINT table_denial`;
      await assert.rejects(operation(), predicate);
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT table_denial`;
      await tx.$executeRaw`RELEASE SAVEPOINT table_denial`;
    }
    await deny(() => service.create(user.id, a.id, { number: '12' }), { status: 409 });
    await deny(() => tx.restaurantTable.create({ data: { shopId: a.id, number: '13', code: 'T12' } }), { code: 'P2002' });
    await deny(() => tx.restaurantTable.create({ data: { shopId: a.id, number: '', code: 'T-empty' } }), error => /constraint/i.test(error.message));
    for (const number of ['A3', 'Patio 4', '012', '露台 4', 'x'.repeat(40)]) {
      const saved = (await service.create(user.id, a.id, { number })).table;
      assert.equal(saved.number, number);
      assert.match(saved.code, /^[A-Za-z0-9-]+$/);
      assert.equal((await tx.restaurantTable.findUniqueOrThrow({ where: { id: saved.id } })).number, number);
    }
    await deny(() => service.create(user.id, a.id, { number: 'a3' }), { status: 409 });
    await deny(() => service.create(user.id, a.id, { number: ' Patio   4 ' }), { status: 409 });
    const sameLabel = (await service.create(user.id, b.id, { number: 'Patio 4' })).table;
    assert.equal(sameLabel.shopId, b.id);
    assert.ok((await service.list(user.id, a.id)).tables.some(t => t.number === 'Patio 4'));
    for (const role of ['MANAGER', 'CASHIER', 'KITCHEN']) {
      await tx.shopMember.update({ where: { userId_shopId: { userId: user.id, shopId: a.id } }, data: { role } });
      await assert.rejects(service.create(user.id, a.id, { number: '20' }), { status: 403 });
      await deny(() => repository.create(user.id, a.id, '20', 'T20'), { code: 'P2025' });
      assert.equal(await repository.list(user.id, a.id), null);
    }
    await tx.shop.update({ where: { id: b.id }, data: { isActive: false } });
    await assert.rejects(service.create(user.id, b.id, { number: '20' }), { status: 404 });
    await deny(() => repository.create(user.id, b.id, '20', 'T20'), { code: 'P2025' });
    assert.equal(await tx.restaurantTable.count({ where: { shopId: a.id, number: '20' } }), 0);
    throw rollback;
  }, { timeout: 60000 }), error => error === rollback);
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  console.log('Live table checks passed: text labels, leading zeros, persistence, case-insensitive per-shop uniqueness, normalization, label bounds, isolated resources, OWNER/ADMIN access, role revocation, inactive-shop denial and RLS. All fixtures rolled back.');
} finally { await prisma.$disconnect(); }
