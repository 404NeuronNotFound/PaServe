import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { ProductsRepository } from '../dist/modules/products/products.repository.js';
import { ProductsService } from '../dist/modules/products/products.service.js';
import { PublicMenuRepository } from '../dist/modules/categories/public-menu.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { TenantResourcesService } from '../dist/modules/tenancy/tenant-resources.service.js';
import { TenantResourcesRepository } from '../dist/modules/tenancy/tenant-resources.repository.js';

const prisma = new PrismaService();
const userId = randomUUID(),
  shopId = randomUUID(),
  otherShop = randomUUID();
const email = `product-order-${userId}@example.com`;
try {
  await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: { id: userId, email, passwordHash: 'unused' },
    });
    for (const id of [shopId, otherShop])
      await tx.shop.create({
        data: {
          id,
          name: 'Product order fixture',
          slug: `product-order-${id}`,
          members: { create: { userId, role: 'OWNER' } },
        },
      });
  });
  const category = await prisma.category.create({
    data: { shopId, name: 'Coffee', slug: 'coffee' },
  });
  const otherCategory = await prisma.category.create({
    data: { shopId, name: 'Meals', slug: 'meals' },
  });
  const products = [];
  for (const [index, name] of ['Latte', 'Mocha', 'Tea'].entries())
    products.push(
      await prisma.product.create({
        data: {
          shopId,
          categoryId: category.id,
          name,
          slug: name.toLowerCase(),
          price: '123.45',
          status: index === 1 ? 'HIDDEN' : 'AVAILABLE',
          sortOrder: index * 7,
        },
      }),
    );
  const archived = await prisma.product.create({
    data: {
      shopId,
      categoryId: category.id,
      name: 'Archive',
      slug: 'archive',
      price: '1.00',
      isArchived: true,
      sortOrder: 99,
    },
  });
  const foreign = await prisma.product.create({
    data: {
      shopId: otherShop,
      name: 'Foreign',
      slug: 'foreign',
      price: '1.00',
    },
  });
  const elsewhere = await prisma.product.create({
    data: {
      shopId,
      categoryId: otherCategory.id,
      name: 'Meal',
      slug: 'meal',
      price: '1.00',
      sortOrder: 55,
    },
  });
  const uncategorized = [];
  for (const [index, name] of ['Water', 'Juice'].entries())
    uncategorized.push(
      await prisma.product.create({
        data: {
          shopId,
          name,
          slug: name.toLowerCase(),
          price: '2.00',
          sortOrder: index,
        },
      }),
    );
  const repository = new ProductsRepository(prisma);
  const members = new ShopMembersService(new ShopMembersRepository(prisma));
  const service = new ProductsService(
    repository,
    members,
    new TenantResourcesService(members, new TenantResourcesRepository(prisma)),
  );
  const menu = new PublicMenuRepository(prisma);
  const list = async () => (await service.list(userId, shopId)).products;
  const original = products.map((p) => p.id),
    reversed = [...original].reverse();
  const result = await service.reorder(userId, shopId, {
    categoryId: category.id,
    productIds: reversed,
    expectedOrder: original,
  });
  assert.deepEqual(
    result.products.map((p) => p.id),
    reversed,
  );
  assert.deepEqual(
    result.products.map((p) => p.sortOrder),
    [0, 1, 2],
  );
  assert.deepEqual(
    (await list())
      .filter((p) => p.categoryId === category.id && !p.isArchived)
      .map((p) => p.id),
    reversed,
  );
  assert.deepEqual(
    (await menu.read(`product-order-${shopId}`)).products
      .filter((p) => p.categoryId === category.id)
      .map((p) => p.id),
    [original[2], original[0]],
  );
  for (const before of products) {
    const after = await prisma.product.findUniqueOrThrow({
      where: { id: before.id },
    });
    assert.deepEqual(
      { ...after, updatedAt: before.updatedAt, sortOrder: before.sortOrder },
      before,
    );
  }
  for (const before of [archived, foreign, elsewhere, ...uncategorized])
    assert.deepEqual(
      await prisma.product.findUniqueOrThrow({ where: { id: before.id } }),
      before,
    );
  await assert.rejects(
    service.reorder(userId, shopId, {
      categoryId: category.id,
      productIds: original,
      expectedOrder: original,
    }),
    { status: 409 },
  );
  for (const wrong of [foreign, elsewhere, archived, uncategorized[0]]) {
    const invalid = [wrong.id, ...original.slice(1)];
    await assert.rejects(
      service.reorder(userId, shopId, {
        categoryId: category.id,
        productIds: invalid,
        expectedOrder: invalid,
      }),
      { status: 404 },
    );
  }
  await assert.rejects(
    service.reorder(userId, shopId, {
      categoryId: category.id,
      productIds: [original[0]],
      expectedOrder: [original[0]],
    }),
    { status: 409 },
  );
  const beforeFailure = await list();
  const failingPrisma = {
    $transaction: (callback, options) =>
      prisma.$transaction(async (tx) => {
        let writes = 0;
        return callback({
          shop: tx.shop,
          category: tx.category,
          product: {
            update: async (args) => {
              if (++writes === 2)
                throw new Prisma.PrismaClientKnownRequestError(
                  'Fixture denied write',
                  { code: 'P2025', clientVersion: 'test' },
                );
              return tx.product.update(args);
            },
          },
        });
      }, options),
  };
  await assert.rejects(
    new ProductsRepository(failingPrisma).reorder(
      userId,
      shopId,
      category.id,
      original,
      reversed,
    ),
    { code: 'P2025' },
  );
  assert.deepEqual(await list(), beforeFailure);
  const competing = await Promise.allSettled([
    service.reorder(userId, shopId, {
      categoryId: category.id,
      productIds: original,
      expectedOrder: reversed,
    }),
    service.reorder(userId, shopId, {
      categoryId: category.id,
      productIds: [original[1], original[0], original[2]],
      expectedOrder: reversed,
    }),
  ]);
  assert.equal(competing.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    competing.find((r) => r.status === 'rejected').reason.status,
    409,
  );
  const uncategorizedIds = uncategorized.map((p) => p.id);
  assert.deepEqual(
    (
      await service.reorder(userId, shopId, {
        categoryId: null,
        productIds: [...uncategorizedIds].reverse(),
        expectedOrder: uncategorizedIds,
      })
    ).products.map((p) => p.id),
    [...uncategorizedIds].reverse(),
  );
  for (const role of ['ADMIN', 'MANAGER']) {
    await prisma.shopMember.update({
      where: { userId_shopId: { userId, shopId } },
      data: { role },
    });
    const current = (await list())
      .filter((p) => p.categoryId === category.id && !p.isArchived)
      .map((p) => p.id);
    await service.reorder(userId, shopId, {
      categoryId: category.id,
      productIds: [...current].reverse(),
      expectedOrder: current,
    });
  }
  for (const role of ['CASHIER', 'KITCHEN']) {
    await prisma.shopMember.update({
      where: { userId_shopId: { userId, shopId } },
      data: { role },
    });
    await assert.rejects(
      service.reorder(userId, shopId, {
        categoryId: category.id,
        productIds: original,
        expectedOrder: reversed,
      }),
      { status: 403 },
    );
    await assert.rejects(
      repository.reorder(
        userId,
        shopId,
        null,
        uncategorizedIds,
        uncategorizedIds,
      ),
      { status: 403 },
    );
  }
  console.log(
    'Verified persisted category/Uncategorized ordering, public filtering, hidden placement, metadata preservation, tenant/category/archive denials, roles, stale lists, competing saves and real SQL rollback.',
  );
} finally {
  await prisma.shop.deleteMany({
    where: {
      id: { in: [shopId, otherShop] },
      slug: { in: [`product-order-${shopId}`, `product-order-${otherShop}`] },
    },
  });
  await prisma.user.deleteMany({ where: { id: userId, email } });
  assert.equal(
    await prisma.shop.count({ where: { id: { in: [shopId, otherShop] } } }),
    0,
  );
  assert.equal(await prisma.user.count({ where: { id: userId } }), 0);
  await prisma.$disconnect();
}
