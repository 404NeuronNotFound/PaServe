import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ShopsRepository } from '../dist/modules/shops/shops.repository.js';
import { ShopsService } from '../dist/modules/shops/shops.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { TenantResourcesRepository } from '../dist/modules/tenancy/tenant-resources.repository.js';
import { TenantResourcesService } from '../dist/modules/tenancy/tenant-resources.service.js';

const prisma = new PrismaService();
const email = `tenant-check-${randomUUID()}@example.com`;
const rollback = new Error('Intentional tenant fixture rollback');
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash: 'unused-test-hash' },
        });
        const shops = new ShopsService(new ShopsRepository(tx));
        const { shop: a } = await shops.create(user.id, {
          name: `Tenant A ${randomUUID()}`,
        });
        const { shop: b } = await shops.create(user.id, {
          name: `Tenant B ${randomUUID()}`,
        });
        const categoryA = await tx.category.create({
          data: { shopId: a.id, name: 'A', slug: 'a' },
        });
        const categoryB = await tx.category.create({
          data: { shopId: b.id, name: 'B', slug: 'b' },
        });
        const productA = await tx.product.create({
          data: {
            shopId: a.id,
            categoryId: categoryA.id,
            name: 'A',
            slug: 'a',
            price: '10.00',
          },
        });
        const productB = await tx.product.create({
          data: {
            shopId: b.id,
            categoryId: categoryB.id,
            name: 'B',
            slug: 'b',
            price: '20.00',
          },
        });
        const repository = new TenantResourcesRepository(tx);
        const members = new ShopMembersService(new ShopMembersRepository(tx));
        const service = new TenantResourcesService(members, repository);
        for (const [kind, own, foreign] of [
          ['product', productA, productB],
          ['category', categoryA, categoryB],
        ]) {
          assert.equal(
            (await service.requireResource(user.id, a.id, kind, own.id))
              .resource.id,
            own.id,
          );
          assert.equal(
            (await service.requireResource(user.id, b.id, kind, foreign.id))
              .resource.id,
            foreign.id,
          );
          await assert.rejects(
            service.requireResource(user.id, a.id, kind, foreign.id),
            { status: 404 },
          );
          await assert.rejects(
            service.requireResource(user.id, b.id, kind, own.id),
            { status: 404 },
          );
        }

        async function foreignKeyDenial(operation) {
          await tx.$executeRaw`SAVEPOINT tenant_constraint_check`;
          let failure;
          try {
            await operation();
          } catch (error) {
            failure = error;
          }
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT tenant_constraint_check`;
          await tx.$executeRaw`RELEASE SAVEPOINT tenant_constraint_check`;
          assert.equal(
            failure?.code,
            'P2003',
            'Expected a tenant foreign-key denial',
          );
        }
        await foreignKeyDenial(() =>
          tx.product.create({
            data: {
              shopId: a.id,
              categoryId: categoryB.id,
              name: 'Wrong link',
              slug: 'wrong',
              price: '1.00',
            },
          }),
        );
        await foreignKeyDenial(() =>
          tx.product.update({
            where: { id: productA.id },
            data: { categoryId: categoryB.id },
          }),
        );
        await foreignKeyDenial(() =>
          tx.product.update({
            where: { id: productA.id },
            data: { shopId: b.id },
          }),
        );
        await foreignKeyDenial(() =>
          tx.category.update({
            where: { id: categoryA.id },
            data: { shopId: b.id },
          }),
        );

        await tx.category.delete({ where: { id: categoryB.id } });
        const retained = await tx.product.findUniqueOrThrow({
          where: { id: productB.id },
        });
        assert.equal(retained.shopId, b.id);
        assert.equal(retained.categoryId, null);
        await tx.shopMember.delete({
          where: { userId_shopId: { userId: user.id, shopId: a.id } },
        });
        assert.equal(
          await repository.findResource(user.id, a.id, 'product', productA.id),
          null,
        );
        await assert.rejects(
          service.requireResource(user.id, a.id, 'product', productA.id),
          { status: 404 },
        );
        await tx.user.update({
          where: { id: user.id },
          data: { isActive: false },
        });
        assert.equal(
          await repository.findResource(user.id, b.id, 'product', productB.id),
          null,
        );
        throw rollback;
      },
      { timeout: 30000, maxWait: 10000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);

  const tables = await prisma.$queryRaw`
    SELECT c.relname, c.relrowsecurity,
      has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
      has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS browser_access
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('shops', 'shop_members', 'categories', 'products')`;
  assert.equal(tables.length, 4);
  for (const table of tables) {
    assert.equal(table.relrowsecurity, true);
    assert.equal(table.anon_access, false);
    assert.equal(table.browser_access, false);
  }
  console.log(
    'Verified real resource ownership, multi-shop ID isolation, live access rechecks, cross-shop category FK denials, safe category deletion and RLS/browser restrictions. All fixtures rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
