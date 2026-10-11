import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ProductVariantsRepository } from '../dist/modules/products/product-variants.repository.js';
import { ProductVariantsService } from '../dist/modules/products/product-variants.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { TenantResourcesService } from '../dist/modules/tenancy/tenant-resources.service.js';
import { TenantResourcesRepository } from '../dist/modules/tenancy/tenant-resources.repository.js';

const prisma = new PrismaService();
const userId = randomUUID(),
  shopId = randomUUID(),
  productId = randomUUID(),
  groupId = randomUUID();
const members = new ShopMembersService(new ShopMembersRepository(prisma));
const repository = new ProductVariantsRepository(prisma);
const service = new ProductVariantsService(
  repository,
  members,
  new TenantResourcesService(members, new TenantResourcesRepository(prisma)),
);
const conflict = (error) => error.getStatus?.() === 409;
try {
  await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: userId,
        email: `variant-delete-${userId}@example.com`,
        passwordHash: 'unused',
      },
    });
    await tx.shop.create({
      data: {
        id: shopId,
        name: 'Deletion test fixture',
        slug: `variant-delete-${shopId}`,
        members: { create: { userId, role: 'OWNER' } },
      },
    });
    await tx.product.create({
      data: {
        id: productId,
        shopId,
        name: 'Fixture latte',
        slug: `fixture-${productId}`,
        price: '120',
      },
    });
    await tx.productOptionGroup.create({
      data: { id: groupId, shopId, productId, name: 'Size', isRequired: true },
    });
  });
  const create = async (name, isDefault = false) =>
    (
      await service.createVariant(userId, shopId, productId, {
        name,
        priceAdjustment: isDefault ? '0' : '25',
        optionGroupId: groupId,
        isDefault,
      })
    ).variant;
  const regular = await create('Regular', true);
  const large = await create('Large');
  await assert.rejects(
    () => service.deleteVariant(userId, shopId, productId, regular.id),
    conflict,
  );
  await service.deleteVariant(userId, shopId, productId, large.id);
  assert.equal(
    await prisma.productVariant.count({ where: { id: large.id, shopId } }),
    0,
  );
  await service.updateVariant(userId, shopId, productId, regular.id, {
    isDefault: false,
  });
  await assert.rejects(
    () => service.deleteVariant(userId, shopId, productId, regular.id),
    conflict,
  );
  const replacement = await create('Large');
  const concurrent = await Promise.allSettled([
    service.deleteVariant(userId, shopId, productId, regular.id),
    service.deleteVariant(userId, shopId, productId, replacement.id),
  ]);
  assert.equal(
    concurrent.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const failure = concurrent.find((result) => result.status === 'rejected');
  assert.equal(conflict(failure.reason), true);
  const remaining = await prisma.productVariant.findMany({
    where: { shopId, productId, optionGroupId: groupId, isAvailable: true },
  });
  assert.equal(remaining.length, 1);
  await service.updateGroup(userId, shopId, productId, groupId, {
    isRequired: false,
  });
  await service.deleteVariant(userId, shopId, productId, remaining[0].id);
  assert.equal(
    await prisma.productVariant.count({ where: { shopId, productId } }),
    0,
  );
  const scoped = await create('Scoped option');
  await assert.rejects(
    () => service.deleteVariant(userId, shopId, randomUUID(), scoped.id),
    (error) => error.getStatus?.() === 404,
  );
  await prisma.shopMember.update({
    where: { userId_shopId: { userId, shopId } },
    data: { role: 'CASHIER' },
  });
  await assert.rejects(
    () => service.deleteVariant(userId, shopId, productId, scoped.id),
    (error) => error.getStatus?.() === 403,
  );
  await assert.rejects(
    () => repository.deleteVariant(userId, shopId, productId, scoped.id),
    (error) => error.getStatus?.() === 404,
  );
  assert.equal(
    await prisma.productVariant.count({ where: { id: scoped.id, shopId } }),
    1,
  );
  console.log(
    'Option deletion, default/required-group safeguards, simultaneous deletion, product scope and live permission checks passed.',
  );
} finally {
  // Only the randomly identified fixture shop/user created above are removed.
  await prisma.shop.deleteMany({
    where: { id: shopId, slug: `variant-delete-${shopId}` },
  });
  await prisma.user.deleteMany({
    where: { id: userId, email: `variant-delete-${userId}@example.com` },
  });
  await prisma.$disconnect();
}
