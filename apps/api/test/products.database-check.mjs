import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ProductsRepository } from '../dist/modules/products/products.repository.js';
import { ProductsService } from '../dist/modules/products/products.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { TenantResourcesService } from '../dist/modules/tenancy/tenant-resources.service.js';
import { TenantResourcesRepository } from '../dist/modules/tenancy/tenant-resources.repository.js';
import { PublicMenuRepository } from '../dist/modules/categories/public-menu.repository.js';
const prisma = new PrismaService();
const email = `products-${randomUUID()}@example.com`;
const rollback = new Error('Intentional product rollback');
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash: 'unused' },
        });
        const makeShop = () =>
          tx.shop.create({
            data: {
              name: 'Product fixture',
              slug: `products-${randomUUID()}`,
              members: { create: { userId: user.id, role: 'OWNER' } },
            },
          });
        const shop = await makeShop(),
          other = await makeShop();
        const category = await tx.category.create({
          data: { shopId: shop.id, name: 'Coffee', slug: 'coffee' },
        });
        const repository = new ProductsRepository(tx);
        const members = new ShopMembersService(new ShopMembersRepository(tx));
        const service = new ProductsService(
          repository,
          members,
          new TenantResourcesService(
            members,
            new TenantResourcesRepository(tx),
          ),
        );
        const created = await service.create(user.id, shop.id, {
          name: ' Latte ',
          categoryId: category.id,
          price: '12.5',
          description: ' Milky ',
          imageUrl: 'https://example.com/latte.jpg',
          status: 'SOLD_OUT',
          isFeatured: true,
          sortOrder: 7,
        });
        assert.equal(created.product.name, 'Latte');
        assert.equal(created.product.slug, 'latte');
        assert.equal(created.product.price, '12.50');
        assert.equal(created.product.shopId, shop.id);
        assert.equal(created.product.categoryId, category.id);
        assert.equal(created.product.description, 'Milky');
        assert.equal(created.product.isFeatured, true);
        assert.equal(created.product.status, 'SOLD_OUT');
        assert.equal(created.product.sortOrder, 7);
        const beforeEdit = await tx.product.findFirstOrThrow({
          where: { id: created.product.id, shopId: shop.id },
        });
        const edited = await service.update(
          user.id,
          shop.id,
          created.product.id,
          {
            name: ' Iced latte ',
            price: '15.75',
            description: '',
            imageUrl: '',
            isFeatured: false,
          },
        );
        const afterEdit = await tx.product.findFirstOrThrow({
          where: { id: created.product.id, shopId: shop.id },
        });
        assert.equal(edited.product.price, '15.75');
        assert.equal(afterEdit.name, 'Iced latte');
        assert.equal(afterEdit.slug, beforeEdit.slug);
        assert.equal(afterEdit.shopId, beforeEdit.shopId);
        assert.equal(
          afterEdit.createdAt.toISOString(),
          beforeEdit.createdAt.toISOString(),
        );
        assert.equal(afterEdit.categoryId, beforeEdit.categoryId);
        assert.equal(afterEdit.status, beforeEdit.status);
        assert.equal(afterEdit.description, null);
        assert.equal(afterEdit.imageUrl, null);
        assert.equal(afterEdit.isFeatured, false);
        await service.update(user.id, shop.id, created.product.id, {
          categoryId: null,
        });
        assert.equal(
          (await service.list(user.id, shop.id)).products[0].categoryId,
          null,
        );
        await service.update(user.id, shop.id, created.product.id, {
          categoryId: category.id,
        });
        assert.equal(
          (await service.list(user.id, shop.id)).products[0].categoryId,
          category.id,
        );
        const beforeRejectedEdit = await tx.product.findFirstOrThrow({
          where: { id: created.product.id, shopId: shop.id },
        });
        await assert.rejects(
          service.update(user.id, other.id, created.product.id, { price: '1' }),
          (error) => error.getStatus() === 404,
        );
        const foreignCategory = await tx.category.create({
          data: { shopId: other.id, name: 'Foreign', slug: 'foreign' },
        });
        await assert.rejects(
          service.update(user.id, shop.id, created.product.id, {
            categoryId: foreignCategory.id,
          }),
          (error) => error.getStatus() === 404,
        );
        assert.deepEqual(
          await tx.product.findFirstOrThrow({
            where: { id: created.product.id, shopId: shop.id },
          }),
          beforeRejectedEdit,
        );
        const zero = await service.create(user.id, shop.id, {
          name: 'Water',
          price: '0',
        });
        assert.equal(zero.product.price, '0.00');
        assert.equal(zero.product.categoryId, null);
        assert.equal(zero.product.status, 'AVAILABLE');
        assert.equal(zero.product.sortOrder, 0);
        const hidden = await service.create(user.id, shop.id, {
          name: 'Draft',
          price: '1',
          status: 'HIDDEN',
        });
        const publicMenus = new PublicMenuRepository(tx);
        let menu = await publicMenus.read(shop.slug);
        const customerProduct = menu.products.find(
          (item) => item.id === created.product.id,
        );
        assert.equal(customerProduct.name, 'Iced latte');
        assert.equal(customerProduct.price.toFixed(2), '15.75');
        assert.equal(customerProduct.description, null);
        assert.equal(customerProduct.imageUrl, null);
        assert.equal(customerProduct.isFeatured, false);
        assert.equal(customerProduct.slug, 'latte');
        assert.equal(
          menu.products.some((item) => item.id === created.product.id),
          true,
        );
        assert.equal(
          menu.products.some((item) => item.id === hidden.product.id),
          false,
        );
        await tx.category.update({
          where: { id: category.id, shopId: shop.id },
          data: { isVisible: false },
        });
        menu = await publicMenus.read(shop.slug);
        assert.equal(
          menu.products.some((item) => item.id === created.product.id),
          false,
        );
        assert.equal(
          menu.products.some((item) => item.id === zero.product.id),
          true,
        );
        await assert.rejects(
          service.create(user.id, other.id, {
            name: 'Foreign',
            categoryId: category.id,
            price: '1',
          }),
          (error) => error.getStatus() === 404,
        );
        assert.equal(
          await tx.product.count({ where: { shopId: other.id } }),
          0,
        );
        const sameName = await service.create(user.id, other.id, {
          name: 'Latte',
          price: '99999999.99',
        });
        assert.equal(sameName.product.slug, created.product.slug);
        assert.equal(sameName.product.price, '99999999.99');
        await tx.$executeRawUnsafe('SAVEPOINT duplicate_product');
        await assert.rejects(
          service.create(user.id, shop.id, { name: 'Latte', price: '1' }),
          (error) => error.getStatus() === 409,
        );
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT duplicate_product');
        const listed = await service.list(user.id, shop.id);
        assert.deepEqual(
          listed.products.map((item) => item.sortOrder),
          [0, 0, 7],
        );
        await tx.shopMember.update({
          where: { userId_shopId: { userId: user.id, shopId: shop.id } },
          data: { role: 'CASHIER' },
        });
        await assert.rejects(
          service.create(user.id, shop.id, { name: 'Denied', price: '1' }),
          (error) => error.getStatus() === 403,
        );
        await assert.rejects(
          service.update(user.id, shop.id, created.product.id, { price: '1' }),
          (error) => error.getStatus() === 403,
        );
        await tx.$executeRawUnsafe('SAVEPOINT lost_edit_access');
        await assert.rejects(
          repository.update(user.id, shop.id, created.product.id, undefined, {
            price: '1',
          }),
          (error) => error.code === 'P2025',
        );
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT lost_edit_access');
        assert.equal(
          (
            await tx.product.findFirstOrThrow({
              where: { id: created.product.id, shopId: shop.id },
            })
          ).price.toFixed(2),
          '15.75',
        );
        await tx.$executeRawUnsafe('SAVEPOINT lost_access');
        await assert.rejects(
          repository.create(user.id, shop.id, category.id, {
            name: 'Denied',
            slug: 'denied',
            price: '1',
            description: null,
            imageUrl: null,
            status: 'AVAILABLE',
            isFeatured: false,
            sortOrder: 0,
          }),
          (error) => error.code === 'P2025',
        );
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT lost_access');
        assert.equal(
          await tx.product.count({
            where: { shopId: shop.id, slug: 'denied' },
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
    'Product database verification passed; all fixtures rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
