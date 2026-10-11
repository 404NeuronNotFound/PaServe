import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { TablesRepository } from '../dist/modules/tables/tables.repository.js';
import { TablesService } from '../dist/modules/tables/tables.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { TenantResourcesRepository } from '../dist/modules/tenancy/tenant-resources.repository.js';
import { TABLE_CODE_PATTERN, publicTablePath } from '@paserve/contracts';
import { PublicTablesRepository } from '../dist/modules/tables/public-tables.repository.js';
import { PublicMenuRepository } from '../dist/modules/categories/public-menu.repository.js';
import { PublicMenuController } from '../dist/modules/categories/public-menu.controller.js';

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
    assert.match(one.code, TABLE_CODE_PATTERN); assert.equal(one.isActive, true);
    assert.notEqual(one.code, one.id);
    assert.notEqual(one.code, two.code);
    const publicTables = new PublicTablesRepository(tx);
    const publicMenus = new PublicMenuRepository(tx);
    const controller = new PublicMenuController(publicMenus, publicTables);
    const response = { setHeader() {} };
    const scanned = await controller.readTable(a.slug, one.code, response);
    assert.equal(scanned.shop.slug, a.slug);
    assert.deepEqual(scanned.table, { shopSlug: a.slug, code: one.code, number: '12' });
    assert.ok(!JSON.stringify(scanned).includes(one.id) && !JSON.stringify(scanned).includes(a.id));
    assert.equal(await publicTables.resolve(b.slug, one.code), null);
    await assert.rejects(controller.readTable(b.slug, one.code, response));
    // Codes are namespaced by shop: identical tokens must still resolve locally.
    await tx.restaurantTable.update({ where: { id: two.id, shopId: b.id }, data: { code: one.code, number: 'Patio 4' } });
    assert.deepEqual(await publicTables.resolve(b.slug, one.code), { shopSlug: b.slug, code: one.code, number: 'Patio 4' });
    await tx.restaurantTable.update({ where: { id: two.id, shopId: b.id }, data: { code: two.code, number: '12' } });
    await tx.restaurantTable.update({ where: { id: one.id, shopId: a.id }, data: { isActive: false } });
    assert.equal(await publicTables.resolve(a.slug, one.code), null);
    assert.equal(await publicMenus.read(a.slug, one.code), null);
    await assert.rejects(controller.readTable(a.slug, one.code, response));
    await tx.restaurantTable.update({ where: { id: one.id, shopId: a.id }, data: { isActive: true } });
    await tx.shop.update({ where: { id: a.id }, data: { isActive: false } });
    assert.equal(await publicTables.resolve(a.slug, one.code), null);
    await assert.rejects(controller.readTable(a.slug, one.code, response));
    await tx.shop.update({ where: { id: a.id }, data: { isActive: true } });
    const publicPath = publicTablePath(a.slug, one.code);
    assert.equal(publicPath, `/${a.slug}/table/${one.code}`);
    assert.ok(!publicPath.includes(one.id) && !publicPath.includes(a.id) && !publicPath.includes(user.id));
    assert.equal((await service.list(user.id, a.id)).tables.find(t => t.id === one.id).code, one.code);
    await tx.restaurantTable.update({ where: { id: one.id, shopId: a.id }, data: { number: 'Renamed', isActive: false } });
    assert.equal((await tx.restaurantTable.findUniqueOrThrow({ where: { id: one.id } })).code, one.code);
    await tx.restaurantTable.update({ where: { id: one.id, shopId: a.id }, data: { number: '12', isActive: true } });
    assert.equal((await service.list(user.id, a.id)).tables.find(t => t.id === one.id).code, one.code);
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
    await deny(() => tx.restaurantTable.create({ data: { shopId: a.id, number: '13', code: one.code } }), { code: 'P2002' });
    // Exercise collision recovery using a real PostgreSQL unique violation.
    // Savepoint recovery keeps this fixture transaction usable between attempts.
    let collisionAttempts = 0;
    const retryService = new TablesService({
      async create(userId, shopId, number, code) {
        collisionAttempts++;
        if (collisionAttempts > 1) return repository.create(userId, shopId, number, code);
        await tx.$executeRaw`SAVEPOINT table_code_collision`;
        try { return await repository.create(userId, shopId, number, one.code); }
        catch (error) {
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT table_code_collision`;
          await tx.$executeRaw`RELEASE SAVEPOINT table_code_collision`;
          throw error;
        }
      },
    }, new ShopMembersService(new ShopMembersRepository(tx)));
    const recovered = (await retryService.create(user.id, a.id, { number: 'Collision recovery' })).table;
    assert.equal(collisionAttempts, 2);
    assert.match(recovered.code, TABLE_CODE_PATTERN);
    assert.notEqual(recovered.code, one.code);
    await deny(() => tx.restaurantTable.create({ data: { shopId: a.id, number: '', code: 'T-empty' } }), error => /constraint/i.test(error.message));
    for (const number of ['A3', 'Patio 4', '012', '露台 4', 'x'.repeat(40)]) {
      const saved = (await service.create(user.id, a.id, { number })).table;
      assert.equal(saved.number, number);
      assert.match(saved.code, TABLE_CODE_PATTERN);
      assert.equal((await tx.restaurantTable.findUniqueOrThrow({ where: { id: saved.id } })).number, number);
    }
    await deny(() => service.create(user.id, a.id, { number: 'a3' }), { status: 409 });
    await deny(() => service.create(user.id, a.id, { number: ' Patio   4 ' }), { status: 409 });
    const sameLabel = (await service.create(user.id, b.id, { number: 'Patio 4' })).table;
    assert.equal(sameLabel.shopId, b.id);
    assert.ok((await service.list(user.id, a.id)).tables.some(t => t.number === 'Patio 4'));
    const legacy = await tx.restaurantTable.create({ data: { shopId: b.id, number: 'Legacy', code: 'T12' } });
    assert.equal((await service.list(user.id, b.id)).tables.find(t => t.id === legacy.id).code, 'T12');
    assert.equal(publicTablePath(b.slug, legacy.code), `/${b.slug}/table/T12`);
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
