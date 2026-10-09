import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { CategoriesRepository } from '../dist/modules/categories/categories.repository.js';
import { CategoriesService } from '../dist/modules/categories/categories.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { TenantResourcesService } from '../dist/modules/tenancy/tenant-resources.service.js';
import { TenantResourcesRepository } from '../dist/modules/tenancy/tenant-resources.repository.js';
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
        const service = new CategoriesService(
          repository,
          members,
          new TenantResourcesService(
            members,
            new TenantResourcesRepository(tx),
          ),
        );
        const result = await service.create(user.id, shop.id, {
          name: ' Coffee ',
        });
        assert.equal(result.category.shopId, shop.id);
        assert.equal(result.category.name, 'Coffee');
        assert.equal(result.category.slug, 'coffee');
        assert.equal(result.category.isVisible, true);
        assert.equal(result.category.sortOrder, 0);
        const saved = await tx.category.findFirstOrThrow({
          where: { id: result.category.id, shopId: shop.id },
        });
        assert.equal(saved.shopId, shop.id);
        assert.equal(saved.name, 'Coffee');
        assert.equal(saved.slug, 'coffee');
        assert.equal(saved.isVisible, true);
        assert.equal(saved.sortOrder, 0);
        await tx.category.update({
          where: { id: saved.id, shopId: shop.id },
          data: { sortOrder: 7, isVisible: false },
        });
        const product = await tx.product.create({
          data: {
            shopId: shop.id,
            categoryId: saved.id,
            name: 'Fixture coffee',
            slug: 'fixture-coffee',
            price: '10.00',
          },
        });
        const edited = (
          await service.update(user.id, shop.id, saved.id, {
            name: ' Hot Drinks ',
            description: ' Freshly brewed ',
          })
        ).category;
        assert.equal(edited.name, 'Hot Drinks');
        assert.equal(edited.description, 'Freshly brewed');
        assert.equal(edited.shopId, shop.id);
        assert.equal(edited.slug, 'coffee');
        assert.equal(edited.sortOrder, 7);
        assert.equal(edited.isVisible, false);
        assert.equal(
          (await tx.product.findUniqueOrThrow({ where: { id: product.id } }))
            .categoryId,
          saved.id,
        );
        assert.equal(
          (
            await service.update(user.id, shop.id, saved.id, {
              description: ' ',
            })
          ).category.description,
          null,
        );
        await assert.rejects(
          service.update(user.id, other.id, saved.id, { name: 'Foreign edit' }),
          { status: 404 },
        );
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
        await assert.rejects(
          service.update(user.id, other.id, saved.id, {
            name: 'Mixed tenant edit',
          }),
          { status: 404 },
        );
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
          const roleEdit = await service.update(user.id, shop.id, saved.id, {
            description: `Updated by ${role}`,
          });
          assert.equal(roleEdit.category.description, `Updated by ${role}`);
          assert.equal(roleEdit.category.slug, 'coffee');
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
        await tx.$executeRaw`SAVEPOINT category_edit_access`;
        await assert.rejects(
          repository.update(user.id, shop.id, saved.id, {
            name: 'Forbidden edit',
          }),
          { code: 'P2025' },
        );
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT category_edit_access`;
        await tx.$executeRaw`RELEASE SAVEPOINT category_edit_access`;
        assert.equal(
          (await tx.category.findUniqueOrThrow({ where: { id: saved.id } }))
            .name,
          'Hot Drinks',
        );
        for (const role of ['CASHIER', 'KITCHEN']) {
          await tx.shopMember.update({
            where: { userId_shopId: { userId: user.id, shopId: shop.id } },
            data: { role },
          });
          await assert.rejects(
            service.create(user.id, shop.id, { name: 'Forbidden' }),
            { status: 403 },
          );
          await assert.rejects(
            service.update(user.id, shop.id, saved.id, { name: 'Forbidden' }),
            { status: 403 },
          );
        }
        assert.equal(
          await tx.category.count({
            where: { shopId: shop.id, slug: 'forbidden' },
          }),
          0,
        );
        // A denied delete cannot remove the category or detach its products.
        await tx.$executeRaw`SAVEPOINT category_delete_access`;
        await assert.rejects(repository.delete(user.id, shop.id, saved.id), {
          code: 'P2025',
        });
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT category_delete_access`;
        await tx.$executeRaw`RELEASE SAVEPOINT category_delete_access`;
        assert.equal(
          (await tx.product.findUniqueOrThrow({ where: { id: product.id } }))
            .categoryId,
          saved.id,
        );
        await tx.shopMember.update({
          where: { userId_shopId: { userId: user.id, shopId: shop.id } },
          data: { role: 'OWNER' },
        });
        const beforeProduct = await tx.product.update({
          where: { id: product.id, shopId: shop.id },
          data: {
            status: 'HIDDEN',
            isFeatured: true,
            imageUrl: 'https://example.com/coffee.png',
            sortOrder: 9,
          },
        });
        const unrelatedCategory = await tx.category.findFirstOrThrow({
          where: { shopId: other.id, slug: 'coffee' },
        });
        const unrelatedProduct = await tx.product.create({
          data: {
            shopId: other.id,
            categoryId: unrelatedCategory.id,
            name: 'Other coffee',
            slug: 'other-coffee',
            price: '20.00',
            status: 'SOLD_OUT',
          },
        });
        await assert.rejects(service.delete(user.id, other.id, saved.id), {
          status: 404,
        });
        await service.delete(user.id, shop.id, saved.id);
        assert.equal(
          await tx.category.findFirst({
            where: { id: saved.id, shopId: shop.id },
          }),
          null,
        );
        assert.deepEqual(
          await tx.product.findUniqueOrThrow({ where: { id: product.id } }),
          { ...beforeProduct, categoryId: null },
        );
        assert.deepEqual(
          await tx.product.findUniqueOrThrow({
            where: { id: unrelatedProduct.id },
          }),
          unrelatedProduct,
        );
        await assert.rejects(service.delete(user.id, shop.id, saved.id), {
          status: 404,
        });
        // Empty categories are safe to remove too, for both non-owner management roles.
        for (const role of ['ADMIN', 'MANAGER']) {
          await tx.shopMember.update({
            where: { userId_shopId: { userId: user.id, shopId: shop.id } },
            data: { role },
          });
          const empty = await service.create(user.id, shop.id, {
            name: `Empty ${role}`,
          });
          await service.delete(user.id, shop.id, empty.category.id);
          assert.equal(
            await tx.category.count({
              where: { id: empty.category.id, shopId: shop.id },
            }),
            0,
          );
        }
        throw rollback;
      },
      { timeout: 60000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  console.log(
    'Verified category create/edit/delete, defaults, tenant and role denials, write-time permission loss, preserved linked products in Uncategorized and unchanged foreign-shop products. All fixtures rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
