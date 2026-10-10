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
const rollback = new Error('Intentional Regular fixture rollback');
const email = `regular-check-${randomUUID()}@example.com`;
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash: 'unused' },
        });
        const createShop = () =>
          tx.shop.create({
            data: {
              name: 'Regular fixture',
              slug: `regular-${randomUUID()}`,
              members: { create: { userId: user.id, role: 'OWNER' } },
            },
          });
        const shop = await createShop(),
          foreignShop = await createShop();
        const createProduct = (shopId) =>
          tx.product.create({
            data: {
              shopId,
              name: 'Latte',
              slug: randomUUID(),
              price: '120.00',
            },
          });
        const product = await createProduct(shop.id),
          secondProduct = await createProduct(shop.id),
          foreignProduct = await createProduct(foreignShop.id);
        const members = new ShopMembersService(new ShopMembersRepository(tx));
        const repository = new ProductVariantsRepository(tx);
        const service = new ProductVariantsService(
          repository,
          members,
          new TenantResourcesService(
            members,
            new TenantResourcesRepository(tx),
          ),
        );
        assert.equal(
          (await service.list(user.id, shop.id, product.id)).variants.length,
          0,
        );
        const size = (
          await service.createGroup(user.id, shop.id, product.id, {
            name: 'Size',
          })
        ).optionGroup;
        const temperature = (
          await service.createGroup(user.id, shop.id, product.id, {
            name: 'Temperature',
          })
        ).optionGroup;
        const wrongProductGroup = (
          await service.createGroup(user.id, shop.id, secondProduct.id, {
            name: 'Size',
          })
        ).optionGroup;
        const foreignGroup = (
          await service.createGroup(
            user.id,
            foreignShop.id,
            foreignProduct.id,
            { name: 'Size' },
          )
        ).optionGroup;
        const regular = (
          await service.createRegular(user.id, shop.id, product.id, {
            optionGroupId: size.id,
          })
        ).variant;
        assert.equal(regular.name, 'Regular');
        assert.equal(regular.priceAdjustment, '0.00');
        assert.equal(regular.isDefault, true);
        assert.equal(regular.isAvailable, true);
        const savedProduct = await tx.product.findFirstOrThrow({
          where: { id: product.id, shopId: shop.id },
        });
        assert.equal(savedProduct.price.toFixed(2), '120.00');
        // The base amount is stored only on Product; Regular follows later price edits.
        const repricedProduct = await tx.product.update({
          where: { id: product.id, shopId: shop.id },
          data: { price: '145.25' },
        });
        const savedRegular = await repository.findVariant(
          user.id,
          shop.id,
          product.id,
          regular.id,
        );
        assert.equal(
          repricedProduct.price.plus(savedRegular.priceAdjustment).toFixed(2),
          '145.25',
        );
        const ungrouped = (
          await service.createRegular(user.id, shop.id, product.id, {})
        ).variant;
        assert.equal(ungrouped.optionGroupId, null);
        assert.equal(ungrouped.isDefault, true);
        const hot = (
          await service.createVariant(user.id, shop.id, product.id, {
            name: 'Hot',
            priceAdjustment: '0',
            isDefault: true,
            optionGroupId: temperature.id,
          })
        ).variant;
        const large = (
          await service.createVariant(user.id, shop.id, product.id, {
            name: 'Large',
            priceAdjustment: '30',
            optionGroupId: size.id,
          })
        ).variant;
        assert.equal(large.isDefault, false);
        const rejectedWrite = async (operation, predicate) => {
          await tx.$executeRawUnsafe('SAVEPOINT invalid_regular');
          await assert.rejects(operation, predicate);
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_regular');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_regular');
        };
        for (const optionGroupId of [size.id, null]) {
          await rejectedWrite(
            () =>
              service.createRegular(user.id, shop.id, product.id, {
                optionGroupId,
              }),
            (error) => error.getStatus() === 409,
          );
          await rejectedWrite(
            () =>
              service.createVariant(user.id, shop.id, product.id, {
                name: 'Another default',
                priceAdjustment: '0',
                isDefault: true,
                optionGroupId,
              }),
            (error) => error.getStatus() === 409,
          );
        }
        for (const optionGroupId of [wrongProductGroup.id, foreignGroup.id]) {
          await rejectedWrite(
            () =>
              service.createRegular(user.id, shop.id, product.id, {
                optionGroupId,
              }),
            (error) => error.getStatus() === 404,
          );
        }
        await assert.rejects(
          () => service.createRegular(user.id, shop.id, foreignProduct.id, {}),
          (error) => error.getStatus() === 404,
        );
        await assert.rejects(
          () =>
            service.updateVariant(user.id, shop.id, product.id, regular.id, {
              priceAdjustment: '1',
            }),
          (error) => error.getStatus() === 400,
        );
        await assert.rejects(
          () =>
            service.updateVariant(user.id, shop.id, product.id, large.id, {
              isDefault: true,
            }),
          (error) => error.getStatus() === 400,
        );
        await rejectedWrite(
          () =>
            service.updateVariant(user.id, shop.id, product.id, large.id, {
              isDefault: true,
              priceAdjustment: '0',
            }),
          (error) => error.getStatus() === 409,
        );
        await rejectedWrite(
          () =>
            service.updateVariant(user.id, shop.id, product.id, hot.id, {
              optionGroupId: size.id,
            }),
          (error) => error.getStatus() === 409,
        );
        const sqlState = (error) =>
          error.meta?.code ??
          error.meta?.driverAdapterError?.cause?.originalCode;
        await rejectedWrite(
          () =>
            tx.$executeRaw`UPDATE product_variants SET "priceAdjustment" = 1 WHERE id = ${regular.id} AND "shopId" = ${shop.id}`,
          (error) => sqlState(error) === '23514',
        );
        await rejectedWrite(
          () =>
            tx.$executeRaw`UPDATE product_variants SET "isDefault" = true, "priceAdjustment" = 0 WHERE id = ${large.id} AND "shopId" = ${shop.id}`,
          (error) => sqlState(error) === '23505',
        );
        // Exercise the repository alone to prove the database invariant is authoritative.
        await rejectedWrite(
          () =>
            service.write(() =>
              repository.updateVariant(
                user.id,
                shop.id,
                product.id,
                regular.id,
                { priceAdjustment: '1' },
              ),
            ),
          (error) => error.getStatus() === 400,
        );
        await service.updateVariant(user.id, shop.id, product.id, regular.id, {
          isDefault: false,
        });
        const replacement = (
          await service.updateVariant(user.id, shop.id, product.id, large.id, {
            isDefault: true,
            priceAdjustment: '0',
          })
        ).variant;
        assert.equal(replacement.isDefault, true);
        assert.equal(replacement.priceAdjustment, '0.00');
        assert.equal(
          (await service.list(user.id, shop.id, product.id)).variants.filter(
            (variant) => variant.optionGroupId === size.id && variant.isDefault,
          ).length,
          1,
        );
        await service.updateVariant(user.id, shop.id, product.id, large.id, {
          isAvailable: false,
        });
        assert.equal(
          (await repository.findVariant(user.id, shop.id, product.id, large.id))
            .isDefault,
          true,
        );
        // An unavailable default is retained as metadata; no implicit replacement occurs.
        await tx.product.update({
          where: { id: product.id },
          data: { isArchived: true },
        });
        await rejectedWrite(
          () =>
            service.createRegular(user.id, shop.id, product.id, {
              optionGroupId: temperature.id,
            }),
          (error) => error.getStatus() === 404,
        );
        assert.equal(
          await tx.productVariant.count({
            where: { shopId: shop.id, productId: secondProduct.id },
          }),
          0,
        );
        throw rollback;
      },
      { timeout: 90000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  console.log(
    'Explicit Regular/base-price representation, zero adjustments, one default per scope, default edits, foreign links and database constraints passed. Fixtures rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
