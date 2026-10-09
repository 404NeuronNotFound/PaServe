import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { CategoriesRepository } from '../dist/modules/categories/categories.repository.js';
import { CategoriesService } from '../dist/modules/categories/categories.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
const prisma = new PrismaService();
const email = `categories-${randomUUID()}@example.com`;
const rollback = new Error('Intentional category rollback');
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash: 'unused' },
        });
        const shop = await tx.shop.create({
          data: {
            name: 'Category fixture',
            slug: `categories-${randomUUID()}`,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
        });
        const other = await tx.shop.create({
          data: { name: 'Other fixture', slug: `categories-${randomUUID()}` },
        });
        const repository = new CategoriesRepository(tx);
        const members = new ShopMembersService(new ShopMembersRepository(tx));
        const service = new CategoriesService(repository, members);
        const result = await service.create(user.id, shop.id, {
          name: ' Coffee ',
        });
        assert.equal(result.category.shopId, shop.id);
        assert.equal(result.category.name, 'Coffee');
        assert.equal(result.category.slug, 'coffee');
        assert.equal(result.category.isVisible, true);
        assert.equal(
          (await service.list(user.id, shop.id)).categories.length,
          1,
        );
        await assert.rejects(
          service.create(user.id, other.id, { name: 'Foreign' }),
          { status: 404 },
        );
        assert.equal(
          await tx.category.count({ where: { shopId: other.id } }),
          0,
        );
        await tx.$executeRaw`SAVEPOINT category_duplicate`;
        await assert.rejects(
          service.create(user.id, shop.id, { name: 'COFFEE' }),
          { status: 409 },
        );
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT category_duplicate`;
        await tx.$executeRaw`RELEASE SAVEPOINT category_duplicate`;
        await tx.shopMember.create({
          data: { userId: user.id, shopId: other.id, role: 'ADMIN' },
        });
        assert.equal(
          (await service.create(user.id, other.id, { name: 'Coffee' })).category
            .slug,
          'coffee',
        );
        for (const role of ['ADMIN', 'MANAGER']) {
          await tx.shopMember.update({
            where: { userId_shopId: { userId: user.id, shopId: shop.id } },
            data: { role },
          });
          await service.create(user.id, shop.id, { name: `Category ${role}` });
        }
        // Lose permission after a successful check; the repository must still block the write.
        await members.requirePermission(user.id, shop.id, 'shop.menu.manage');
        await tx.shopMember.update({
          where: { userId_shopId: { userId: user.id, shopId: shop.id } },
          data: { role: 'CASHIER' },
        });
        await tx.$executeRaw`SAVEPOINT category_access`;
        await assert.rejects(
          repository.create(user.id, shop.id, 'Forbidden', 'forbidden'),
          { code: 'P2025' },
        );
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT category_access`;
        await tx.$executeRaw`RELEASE SAVEPOINT category_access`;
        assert.equal(await repository.list(user.id, shop.id), null);
        for (const role of ['CASHIER', 'KITCHEN']) {
          await tx.shopMember.update({
            where: { userId_shopId: { userId: user.id, shopId: shop.id } },
            data: { role },
          });
          await assert.rejects(
            service.create(user.id, shop.id, { name: 'Forbidden' }),
            { status: 403 },
          );
        }
        assert.equal(
          await tx.category.count({
            where: { shopId: shop.id, slug: 'forbidden' },
          }),
          0,
        );
        throw rollback;
      },
      { timeout: 60000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  console.log(
    'Verified category create/list, defaults, unique per-shop slugs, cross-tenant denial, all five roles and write-time permission loss. All fixtures rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
