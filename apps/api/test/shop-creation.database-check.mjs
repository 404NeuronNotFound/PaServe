// Run after the API build, from apps/api. All fixtures roll back.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ShopsRepository } from '../dist/modules/shops/shops.repository.js';
import { ShopsService } from '../dist/modules/shops/shops.service.js';

const prisma = new PrismaService();
const email = `shop-check-${randomUUID()}@example.com`;
const rollback = new Error('Intentional fixture rollback');
const options = { timeout: 20000, maxWait: 10000 };
try {
  // Verify success using the real service, repository, and nested Prisma write.
  await assert.rejects(prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, passwordHash: 'unused-test-hash' } });
    const service = new ShopsService(new ShopsRepository(tx));
    const result = await service.create(user.id, { name: ' Café database check ', description: ' Coffee and food ' });
    assert.equal(result.shop.name, 'Café database check');
    assert.equal(result.shop.description, 'Coffee and food');
    assert.equal(result.membership.role, 'OWNER');
    assert.equal(await tx.shopMember.count({ where: { shopId: result.shop.id, userId: user.id, role: 'OWNER' } }), 1);
    throw rollback;
  }, options), (error) => error === rollback);
  assert.equal(await prisma.user.count({ where: { email } }), 0);

  // A membership foreign-key failure must leave no orphan shop.
  const failedSlug = `failed-${randomUUID()}`;
  await assert.rejects(new ShopsRepository(prisma).createWithOwner(randomUUID(), 'Rollback check', failedSlug, null), (error) => error.code === 'P2003');
  assert.equal(await prisma.shop.count({ where: { slug: failedSlug } }), 0);

  // Capture the real adapter's unique-constraint metadata, then exercise retry.
  let collision;
  const duplicateSlug = `duplicate-${randomUUID()}`;
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, passwordHash: 'unused-test-hash' } });
      const repository = new ShopsRepository(tx);
      await repository.createWithOwner(user.id, 'Duplicate check', duplicateSlug, null);
      await repository.createWithOwner(user.id, 'Duplicate check', duplicateSlug, null);
    }, options);
  } catch (error) { collision = error; }
  assert.equal(collision?.code, 'P2002');
  await assert.rejects(prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, passwordHash: 'unused-test-hash' } });
    const repository = new ShopsRepository(tx);
    let first = true;
    const service = new ShopsService({
      createWithOwner(...args) {
        if (first) { first = false; return Promise.reject(collision); }
        return repository.createWithOwner(...args);
      },
    });
    const result = await service.create(user.id, { name: 'Slug retry check' });
    assert.match(result.shop.slug, /^slug-retry-check-[a-f0-9]{8}$/);
    throw rollback;
  }, options), (error) => error === rollback);
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  assert.equal(await prisma.shop.count({ where: { slug: duplicateSlug } }), 0);

  const access = await prisma.$queryRaw`
    SELECT c.relname, c.relrowsecurity,
      has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
      has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS browser_access
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('shops', 'shop_members')`;
  assert.equal(access.length, 2);
  for (const table of access) {
    assert.equal(table.relrowsecurity, true);
    assert.equal(table.anon_access, false);
    assert.equal(table.browser_access, false);
  }
  console.log('Verified live creation, OWNER membership, atomic rollback, slug retry, and browser access restrictions. No fixtures retained.');
} finally {
  await prisma.$disconnect();
}
