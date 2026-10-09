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
  // Audit existing records too: new-write tests alone cannot prove every shop.
  const [slugAudit] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE slug IS NULL OR btrim(slug) = '')::int AS missing,
      COUNT(*) FILTER (WHERE slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$')::int AS unsafe,
      (COUNT(*) - COUNT(DISTINCT slug))::int AS duplicates
    FROM public.shops`;
  assert.equal(slugAudit.missing, 0, 'An existing shop has no slug');
  assert.equal(slugAudit.unsafe, 0, 'An existing shop has a URL-unsafe slug');
  assert.equal(slugAudit.duplicates, 0, 'Existing shops have duplicate slugs');
  console.log(`Audited ${slugAudit.total} existing shops: no missing, URL-unsafe, or duplicate slugs.`);
  // Verify success using the real service, repository, and nested Prisma write.
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash: 'unused-test-hash' },
      });
      const service = new ShopsService(new ShopsRepository(tx));
      const result = await service.create(user.id, {
        name: ' Café database check ',
        description: ' Coffee and food ',
      });
      assert.equal(result.shop.name, 'Café database check');
      assert.equal(result.shop.description, 'Coffee and food');
      assert.equal(result.membership.role, 'OWNER');
      assert.equal(
        await tx.shopMember.count({
          where: { shopId: result.shop.id, userId: user.id, role: 'OWNER' },
        }),
        1,
      );
      throw rollback;
    }, options),
    (error) => error === rollback,
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);

  // A membership foreign-key failure must leave no orphan shop.
  const failedSlug = `failed-${randomUUID()}`;
  await assert.rejects(
    new ShopsRepository(prisma).createWithOwner(
      randomUUID(),
      'Rollback check',
      failedSlug,
      null,
    ),
    (error) => error.code === 'P2003',
  );
  assert.equal(await prisma.shop.count({ where: { slug: failedSlug } }), 0);

  // Exercise real database collisions while retaining rollback-only fixtures.
  // Test savepoints recover the outer transaction after each unique violation;
  // production uses a separate atomic nested write for each service attempt.
  const duplicateName = `Slug retry check ${randomUUID().slice(0, 8)}`;
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash: 'unused-test-hash' },
      });
      const repository = new ShopsRepository(tx);
      const service = new ShopsService({
        async createWithOwner(...args) {
          await tx.$executeRaw`SAVEPOINT shop_slug_attempt`;
          try {
            const record = await repository.createWithOwner(...args);
            await tx.$executeRaw`RELEASE SAVEPOINT shop_slug_attempt`;
            return record;
          } catch (error) {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT shop_slug_attempt`;
            await tx.$executeRaw`RELEASE SAVEPOINT shop_slug_attempt`;
            throw error;
          }
        },
      });
      const first = await service.create(user.id, { name: duplicateName });
      const second = await service.create(user.id, {
        name: duplicateName.toUpperCase(),
      });
      const third = await service.create(user.id, { name: duplicateName });
      assert.equal(
        new Set([first.shop.slug, second.shop.slug, third.shop.slug]).size,
        3,
      );
      for (const result of [second, third]) {
        assert.ok(result.shop.slug.startsWith(`${first.shop.slug}-`));
        assert.match(
          result.shop.slug.slice(first.shop.slug.length),
          /^-[a-f0-9]{8}$/,
        );
        assert.equal(result.membership.shop.slug, result.shop.slug);
      }
      assert.equal(
        await tx.shopMember.count({ where: { userId: user.id } }),
        3,
      );
      throw rollback;
    }, options),
    (error) => error === rollback,
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  assert.equal(await prisma.shop.count({ where: { name: duplicateName } }), 0);
  assert.equal(
    await prisma.shop.count({ where: { name: duplicateName.toUpperCase() } }),
    0,
  );

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
  console.log(
    'Verified live creation, OWNER membership, atomic rollback, slug retry, and browser access restrictions. No fixtures retained.',
  );
} finally {
  await prisma.$disconnect();
}
