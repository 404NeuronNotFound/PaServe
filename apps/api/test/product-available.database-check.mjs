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
import { PublicMenuController } from '../dist/modules/categories/public-menu.controller.js';
import { PublicMenuRepository } from '../dist/modules/categories/public-menu.repository.js';
const prisma = new PrismaService(),
  email = `available-${randomUUID()}@example.com`,
  rollback = new Error('Intentional availability rollback');
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
              name: 'Availability fixture',
              slug: `available-${randomUUID()}`,
              members: { create: { userId: user.id, role: 'OWNER' } },
            },
          });
        const shop = await makeShop(),
          other = await makeShop();
        const category = await tx.category.create({
          data: { shopId: shop.id, name: 'Coffee', slug: 'coffee' },
        });
        const product = await tx.product.create({
          data: {
            shopId: shop.id,
            categoryId: category.id,
            name: 'Latte',
            slug: 'latte',
            price: '12.50',
            status: 'SOLD_OUT',
          },
        });
        const members = new ShopMembersService(new ShopMembersRepository(tx));
        const repository = new ProductsRepository(tx);
        const service = new ProductsService(
          repository,
          members,
          new TenantResourcesService(
            members,
            new TenantResourcesRepository(tx),
          ),
        );
        const menu = new PublicMenuController(new PublicMenuRepository(tx));
        const read = () => menu.read(shop.slug, { setHeader() {} });
        assert.equal((await read()).products[0].isOrderable, false);
        const saved = await service.setAvailable(user.id, shop.id, product.id, {
          expectedStatus: 'SOLD_OUT',
        });
        assert.equal(saved.product.status, 'AVAILABLE');
        assert.equal(saved.product.price, '12.50');
        assert.equal((await read()).products[0].isOrderable, true);
        const featured = await service.setFeatured(
          user.id,
          shop.id,
          product.id,
          { isFeatured: true, expectedFeatured: false },
        );
        assert.equal(featured.product.isFeatured, true);
        assert.equal(featured.product.status, 'AVAILABLE');
        assert.equal((await read()).featuredProducts[0].id, product.id);
        await assert.rejects(
          service.setFeatured(user.id, shop.id, product.id, {
            isFeatured: false,
            expectedFeatured: false,
          }),
          (e) => e.getStatus?.() === 409,
        );
        await assert.rejects(
          service.setFeatured(user.id, other.id, product.id, {
            isFeatured: false,
            expectedFeatured: true,
          }),
          (e) => e.getStatus?.() === 404,
        );
        await service.setFeatured(user.id, shop.id, product.id, {
          isFeatured: false,
          expectedFeatured: true,
        });
        assert.equal((await read()).featuredProducts.length, 0);
        await service.setFeatured(user.id, shop.id, product.id, {
          isFeatured: true,
          expectedFeatured: false,
        });
        const beforeHide = (await service.list(user.id, shop.id)).products[0];
        const hidden = await service.setHidden(user.id, shop.id, product.id, {
          expectedStatus: 'AVAILABLE',
        });
        assert.deepEqual(hidden.product, { ...beforeHide, status: 'HIDDEN' });
        assert.equal((await read()).products.length, 0);
        assert.equal((await read()).featuredProducts.length, 0);
        assert.equal(
          (await service.list(user.id, shop.id)).products[0].status,
          'HIDDEN',
        );
        await assert.rejects(
          service.setHidden(user.id, shop.id, product.id, {
            expectedStatus: 'AVAILABLE',
          }),
          (e) => e.getStatus?.() === 409,
        );
        await assert.rejects(
          service.setHidden(user.id, other.id, product.id, {
            expectedStatus: 'HIDDEN',
          }),
          (e) => e.getStatus?.() === 404,
        );
        await service.update(user.id, shop.id, product.id, {
          description: 'Still editable',
        });
        assert.equal(
          (await service.list(user.id, shop.id)).products[0].description,
          'Still editable',
        );
        await service.setAvailable(user.id, shop.id, product.id, {
          expectedStatus: 'HIDDEN',
        });
        assert.equal((await read()).products[0].isOrderable, true);
        const sold = await service.setSoldOut(user.id, shop.id, product.id, {
          expectedStatus: 'AVAILABLE',
        });
        assert.equal(sold.product.status, 'SOLD_OUT');
        assert.equal(sold.product.price, '12.50');
        assert.equal((await read()).products[0].isOrderable, false);
        assert.equal((await read()).products[0].status, 'SOLD_OUT');
        assert.equal((await read()).featuredProducts[0].isOrderable, false);
        await assert.rejects(
          service.setSoldOut(user.id, shop.id, product.id, {
            expectedStatus: 'AVAILABLE',
          }),
          (e) => e.getStatus?.() === 409,
        );
        await assert.rejects(
          service.setSoldOut(user.id, other.id, product.id, {
            expectedStatus: 'SOLD_OUT',
          }),
          (e) => e.getStatus?.() === 404,
        );
        await service.setAvailable(user.id, shop.id, product.id, {
          expectedStatus: 'SOLD_OUT',
        });

        await assert.rejects(
          service.setAvailable(user.id, shop.id, product.id, {
            expectedStatus: 'SOLD_OUT',
          }),
          (e) => e.getStatus?.() === 409,
        );
        await assert.rejects(
          service.setAvailable(user.id, other.id, product.id, {
            expectedStatus: 'AVAILABLE',
          }),
          (e) => e.getStatus?.() === 404,
        );
        await tx.category.update({
          where: { id: category.id, shopId: shop.id },
          data: { isVisible: false },
        });
        assert.equal((await read()).products.length, 0);
        assert.equal((await read()).featuredProducts.length, 0);
        await service.setSoldOut(user.id, shop.id, product.id, {
          expectedStatus: 'AVAILABLE',
        });
        assert.equal((await read()).products.length, 0);
        assert.equal((await read()).featuredProducts.length, 0);
        await service.setAvailable(user.id, shop.id, product.id, {
          expectedStatus: 'SOLD_OUT',
        });

        await service.setAvailable(user.id, shop.id, product.id, {
          expectedStatus: 'AVAILABLE',
        });
        assert.equal((await read()).products.length, 0);
        assert.equal((await read()).featuredProducts.length, 0);
        assert.equal(
          (
            await tx.category.findFirstOrThrow({
              where: { id: category.id, shopId: shop.id },
            })
          ).isVisible,
          false,
        );
        await tx.product.update({
          where: { id: product.id, shopId: shop.id },
          data: { categoryId: null },
        });
        assert.equal((await read()).products[0].isOrderable, true);
        await tx.product.update({
          where: { id: product.id, shopId: shop.id },
          data: { isArchived: true },
        });
        await assert.rejects(
          service.setAvailable(user.id, shop.id, product.id, {
            expectedStatus: 'AVAILABLE',
          }),
          (e) => e.getStatus?.() === 409,
        );
        assert.equal((await read()).products.length, 0);
        assert.equal((await read()).featuredProducts.length, 0);
        await assert.rejects(
          service.setHidden(user.id, shop.id, product.id, {
            expectedStatus: 'AVAILABLE',
          }),
          (e) => e.getStatus?.() === 409,
        );
        await assert.rejects(
          service.setFeatured(user.id, shop.id, product.id, {
            isFeatured: false,
            expectedFeatured: true,
          }),
          (e) => e.getStatus?.() === 409,
        );
        await tx.product.update({
          where: { id: product.id, shopId: shop.id },
          data: { isArchived: false, status: 'HIDDEN' },
        });
        await tx.shopMember.update({
          where: { userId_shopId: { userId: user.id, shopId: shop.id } },
          data: { role: 'CASHIER' },
        });
        await assert.rejects(
          service.setAvailable(user.id, shop.id, product.id, {
            expectedStatus: 'HIDDEN',
          }),
          (e) => e.getStatus?.() === 403,
        );
        await assert.rejects(
          service.setFeatured(user.id, shop.id, product.id, {
            isFeatured: false,
            expectedFeatured: true,
          }),
          (e) => e.getStatus?.() === 403,
        );
        await tx.product.update({
          where: { id: product.id, shopId: shop.id },
          data: { status: 'SOLD_OUT' },
        });
        await service.setAvailable(user.id, shop.id, product.id, {
          expectedStatus: 'SOLD_OUT',
        });
        assert.equal((await read()).products[0].isOrderable, true);

        await service.setSoldOut(user.id, shop.id, product.id, {
          expectedStatus: 'AVAILABLE',
        });
        assert.equal((await read()).products[0].isOrderable, false);
        await service.setAvailable(user.id, shop.id, product.id, {
          expectedStatus: 'SOLD_OUT',
        });
        await tx.shopMember.update({
          where: { userId_shopId: { userId: user.id, shopId: shop.id } },
          data: { role: 'KITCHEN' },
        });
        await assert.rejects(
          service.setHidden(user.id, shop.id, product.id, {
            expectedStatus: 'AVAILABLE',
          }),
          (e) => e.getStatus?.() === 403,
        );
        await tx.$executeRawUnsafe('SAVEPOINT lost_role');
        await assert.rejects(
          repository.setAvailable(user.id, shop.id, product.id, 'AVAILABLE'),
          (e) => e.code === 'P2025',
        );
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT lost_role');
        await tx.shop.update({
          where: { id: shop.id },
          data: { isActive: false },
        });
        await assert.rejects(read(), (e) => e.getStatus?.() === 404);
        throw rollback;
      },
      { timeout: 60000 },
    ),
    (e) => e === rollback,
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  console.log(
    'Available/Sold out/Hidden persistence and editable retention, featured persistence/public grouping, public orderability, category/archive/shop rules, stale writes, cashier limits and tenant isolation passed. Fixtures rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
