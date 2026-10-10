import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ProductsRepository } from '../dist/modules/products/products.repository.js';
import { ProductsService } from '../dist/modules/products/products.service.js';
import { PublicMenuRepository } from '../dist/modules/categories/public-menu.repository.js';
import { PublicMenuController } from '../dist/modules/categories/public-menu.controller.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { TenantResourcesService } from '../dist/modules/tenancy/tenant-resources.service.js';
import { TenantResourcesRepository } from '../dist/modules/tenancy/tenant-resources.repository.js';

const prisma = new PrismaService();
const userId = randomUUID(),
  shopId = randomUUID(),
  foreignShop = randomUUID();
const email = `featured-order-${userId}@example.com`;
const slug = `featured-order-${shopId}`;
try {
  await prisma.user.create({
    data: { id: userId, email, passwordHash: 'unused' },
  });
  for (const id of [shopId, foreignShop])
    await prisma.shop.create({
      data: {
        id,
        name: 'Featured fixture',
        slug: `featured-order-${id}`,
        members: { create: { userId, role: 'OWNER' } },
      },
    });
  const category = await prisma.category.create({
    data: { shopId, name: 'Coffee', slug: 'coffee' },
  });
  const hiddenCategory = await prisma.category.create({
    data: { shopId, name: 'Private', slug: 'private', isVisible: false },
  });
  const records = [];
  for (const [index, name] of [
    'Coffee',
    'Tea',
    'Hidden',
    'Private',
    'Archived',
    'Normal',
  ].entries()) {
    records.push(
      await prisma.product.create({
        data: {
          shopId,
          name,
          slug: name.toLowerCase(),
          price: '12.50',
          categoryId:
            name === 'Private'
              ? hiddenCategory.id
              : name === 'Coffee'
                ? category.id
                : null,
          isFeatured: name !== 'Normal',
          isArchived: name === 'Archived',
          status:
            name === 'Hidden'
              ? 'HIDDEN'
              : name === 'Tea'
                ? 'SOLD_OUT'
                : 'AVAILABLE',
          sortOrder: index,
          featuredSortOrder: index,
        },
      }),
    );
  }
  const foreign = await prisma.product.create({
    data: {
      shopId: foreignShop,
      name: 'Foreign',
      slug: 'foreign',
      price: '1.00',
      isFeatured: true,
    },
  });
  const members = new ShopMembersService(new ShopMembersRepository(prisma));
  const repository = new ProductsRepository(prisma);
  const service = new ProductsService(
    repository,
    members,
    new TenantResourcesService(members, new TenantResourcesRepository(prisma)),
  );
  const controller = new PublicMenuController(new PublicMenuRepository(prisma));
  const publicRead = () => controller.read(slug, { setHeader() {} });
  const read = async () => (await service.list(userId, shopId)).products;
  const original = records
    .filter((item) => item.isFeatured && !item.isArchived)
    .map((item) => item.id);
  const desired = [...original].reverse();
  await service.reorderFeatured(userId, shopId, {
    productIds: desired,
    expectedOrder: original,
  });
  assert.deepEqual(
    (await read())
      .filter((item) => item.isFeatured && !item.isArchived)
      .sort((a, b) => a.featuredSortOrder - b.featuredSortOrder)
      .map((item) => item.id),
    desired,
  );
  for (const before of records) {
    const after = await prisma.product.findUniqueOrThrow({
      where: { id: before.id },
    });
    assert.deepEqual(
      {
        ...after,
        featuredSortOrder: before.featuredSortOrder,
        updatedAt: before.updatedAt,
      },
      before,
    );
  }
  const menu = await publicRead();
  assert.deepEqual(
    menu.featuredProducts.map((item) => item.name),
    ['Tea', 'Coffee'],
  );
  assert.deepEqual(
    menu.products.map((item) => item.name),
    ['Coffee', 'Tea', 'Normal'],
  );
  assert.equal(menu.featuredProducts[0].isOrderable, false);
  await service.reorder(userId, shopId, {
    categoryId: null,
    productIds: [records[5].id, records[2].id, records[1].id],
    expectedOrder: [records[1].id, records[2].id, records[5].id],
  });
  assert.deepEqual(
    (await publicRead()).featuredProducts.map((item) => item.name),
    ['Tea', 'Coffee'],
  );
  await assert.rejects(
    service.reorderFeatured(userId, shopId, {
      productIds: desired,
      expectedOrder: original,
    }),
    { status: 409 },
  );
  for (const id of [foreign.id, records[4].id, records[5].id])
    await assert.rejects(
      service.reorderFeatured(userId, shopId, {
        productIds: [id],
        expectedOrder: [id],
      }),
      { status: 404 },
    );
  await service.setFeatured(userId, shopId, records[0].id, {
    isFeatured: false,
    expectedFeatured: true,
  });
  assert.deepEqual(
    (await publicRead()).featuredProducts.map((item) => item.name),
    ['Tea'],
  );
  assert.equal(
    (await publicRead()).products.some((item) => item.name === 'Coffee'),
    true,
  );
  await assert.rejects(
    service.reorderFeatured(userId, shopId, {
      productIds: desired,
      expectedOrder: desired,
    }),
    { status: 404 },
  );
  await prisma.shopMember.update({
    where: { userId_shopId: { userId, shopId } },
    data: { role: 'CASHIER' },
  });
  await assert.rejects(
    service.reorderFeatured(userId, shopId, {
      productIds: [records[1].id],
      expectedOrder: [records[1].id],
    }),
    { status: 403 },
  );
  console.log(
    'Verified persisted cross-category featured order, independent category order, public visibility/sold-out rules, unfeature, stale selection, tenant/archive/role protection.',
  );
} finally {
  await prisma.shop.deleteMany({
    where: {
      id: { in: [shopId, foreignShop] },
      slug: { in: [slug, `featured-order-${foreignShop}`] },
    },
  });
  await prisma.user.deleteMany({ where: { id: userId, email } });
  assert.equal(
    await prisma.shop.count({ where: { id: { in: [shopId, foreignShop] } } }),
    0,
  );
  await prisma.$disconnect();
}
