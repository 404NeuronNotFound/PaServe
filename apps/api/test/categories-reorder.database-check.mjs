import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { CategoriesRepository } from '../dist/modules/categories/categories.repository.js';
import { CategoriesService } from '../dist/modules/categories/categories.service.js';
import { PublicMenuRepository } from '../dist/modules/categories/public-menu.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { TenantResourcesService } from '../dist/modules/tenancy/tenant-resources.service.js';
import { TenantResourcesRepository } from '../dist/modules/tenancy/tenant-resources.repository.js';

const prisma = new PrismaService();
const userId = randomUUID(),
  shopId = randomUUID(),
  otherShop = randomUUID();
const email = `reorder-${userId}@example.com`;
try {
  await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: { id: userId, email, passwordHash: 'unused' },
    });
    for (const id of [shopId, otherShop])
      await tx.shop.create({
        data: {
          id,
          name: 'Reorder fixture',
          slug: `reorder-${id}`,
          members: { create: { userId, role: 'OWNER' } },
        },
      });
  });
  const categories = [];
  for (const [index, name] of ['Coffee', 'Meals', 'Pastries'].entries())
    categories.push(
      await prisma.category.create({
        data: {
          shopId,
          name,
          slug: name.toLowerCase(),
          sortOrder: index * 7,
          isVisible: index !== 1,
        },
      }),
    );
  const foreign = await prisma.category.create({
    data: { shopId: otherShop, name: 'Other', slug: 'other', sortOrder: 9 },
  });
  const product = await prisma.product.create({
    data: {
      shopId,
      categoryId: categories[1].id,
      name: 'Meal',
      slug: 'meal',
      price: '12.50',
    },
  });
  const repository = new CategoriesRepository(prisma);
  const members = new ShopMembersService(new ShopMembersRepository(prisma));
  const service = new CategoriesService(
    repository,
    members,
    new TenantResourcesService(members, new TenantResourcesRepository(prisma)),
  );
  const publicMenus = new PublicMenuRepository(prisma);
  const list = async () => (await service.list(userId, shopId)).categories;
  const originalIds = categories.map((category) => category.id);
  const reversed = [...originalIds].reverse();
  const response = await service.reorder(userId, shopId, {
    categoryIds: reversed,
    expectedOrder: originalIds,
  });
  assert.deepEqual(
    response.categories.map((category) => category.id),
    reversed,
  );
  assert.deepEqual(
    response.categories.map((category) => category.sortOrder),
    [0, 1, 2],
  );
  assert.deepEqual(
    (await list()).map((category) => category.id),
    reversed,
  );
  assert.deepEqual(
    (await publicMenus.read(`reorder-${shopId}`)).categories.map(
      (category) => category.id,
    ),
    [originalIds[2], originalIds[0]],
  );
  for (const category of categories) {
    const after = await prisma.category.findFirstOrThrow({
      where: { id: category.id, shopId },
    });
    assert.deepEqual(
      {
        ...after,
        updatedAt: category.updatedAt,
        sortOrder: category.sortOrder,
      },
      category,
    );
  }
  assert.deepEqual(
    await prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
    product,
  );
  assert.deepEqual(
    await prisma.category.findUniqueOrThrow({ where: { id: foreign.id } }),
    foreign,
  );
  await assert.rejects(
    service.reorder(userId, shopId, {
      categoryIds: originalIds,
      expectedOrder: originalIds,
    }),
    { status: 409 },
  );
  await assert.rejects(
    service.reorder(userId, shopId, {
      categoryIds: [foreign.id, ...originalIds.slice(1)],
      expectedOrder: [foreign.id, ...originalIds.slice(1)],
    }),
    { status: 404 },
  );
  await assert.rejects(
    service.reorder(userId, shopId, {
      categoryIds: [originalIds[0]],
      expectedOrder: [originalIds[0]],
    }),
    { status: 409 },
  );
  // Exercise the real transaction with a failure injected after the first SQL write.
  const beforeFailure = await list();
  const failingPrisma = {
    $transaction: (callback, options) =>
      prisma.$transaction(async (tx) => {
        let writes = 0;
        return callback({
          shop: tx.shop,
          category: {
            update: async (args) => {
              if (++writes === 2)
                throw new Prisma.PrismaClientKnownRequestError(
                  'Fixture denied write',
                  { code: 'P2025', clientVersion: 'test' },
                );
              return tx.category.update(args);
            },
          },
        });
      }, options),
  };
  await assert.rejects(
    new CategoriesRepository(failingPrisma).reorder(
      userId,
      shopId,
      originalIds,
      reversed,
    ),
    { code: 'P2025' },
  );
  assert.deepEqual(await list(), beforeFailure);
  const competingOrder = [originalIds[1], originalIds[0], originalIds[2]];
  const competing = await Promise.allSettled([
    service.reorder(userId, shopId, {
      categoryIds: originalIds,
      expectedOrder: reversed,
    }),
    service.reorder(userId, shopId, {
      categoryIds: competingOrder,
      expectedOrder: reversed,
    }),
  ]);
  assert.equal(
    competing.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const conflict = competing.find((result) => result.status === 'rejected');
  assert.equal(conflict.reason.status, 409);
  for (const role of ['ADMIN', 'MANAGER']) {
    await prisma.shopMember.update({
      where: { userId_shopId: { userId, shopId } },
      data: { role },
    });
    const current = (await list()).map((category) => category.id);
    await service.reorder(userId, shopId, {
      categoryIds: [...current].reverse(),
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
        categoryIds: originalIds,
        expectedOrder: reversed,
      }),
      { status: 403 },
    );
    await assert.rejects(
      repository.reorder(userId, shopId, originalIds, reversed),
      { status: 403 },
    );
  }
  console.log(
    'Verified persisted management/public ordering, hidden category placement, metadata/product preservation, cross-tenant and role denials, stale lists, and actual transaction rollback after a partial SQL write.',
  );
} finally {
  // Only IDs generated for this check are eligible for cleanup; cascades remove their fixture children.
  await prisma.shop.deleteMany({
    where: {
      id: { in: [shopId, otherShop] },
      slug: { in: [`reorder-${shopId}`, `reorder-${otherShop}`] },
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
