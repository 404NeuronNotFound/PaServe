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
const rollback = new Error('Intentional variant fixture rollback');
const email = `variant-check-${randomUUID()}@example.com`;
try {
  const tables = await prisma.$queryRaw`
    SELECT relname, relrowsecurity,
      has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
      has_table_privilege('authenticated', oid, 'SELECT,INSERT,UPDATE,DELETE') AS authenticated_access
    FROM pg_class WHERE oid IN ('public.product_variants'::regclass, 'public.product_option_groups'::regclass)`;
  assert.equal(tables.length, 2);
  for (const table of tables) {
    assert.equal(table.relrowsecurity, true);
    assert.equal(table.anon_access, false);
    assert.equal(table.authenticated_access, false);
  }
  const columns = await prisma.$queryRaw`
    SELECT data_type, numeric_precision, numeric_scale FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'product_variants' AND column_name = 'priceAdjustment'`;
  assert.deepEqual(columns[0], {
    data_type: 'numeric',
    numeric_precision: 10,
    numeric_scale: 2,
  });
  const existingConstraints = await prisma.$queryRaw`
    SELECT conname FROM pg_constraint WHERE conname IN ('products_price_nonnegative', 'products_category_tenant_fkey')`;
  assert.equal(existingConstraints.length, 2);
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash: 'unused' },
        });
        const makeShop = () =>
          tx.shop.create({
            data: {
              name: 'Variant fixture',
              slug: `variants-${randomUUID()}`,
              members: { create: { userId: user.id, role: 'OWNER' } },
            },
          });
        const shop = await makeShop(),
          otherShop = await makeShop();
        const makeProduct = (shopId) =>
          tx.product.create({
            data: {
              shopId,
              name: 'Latte',
              slug: randomUUID(),
              price: '120.00',
            },
          });
        const product = await makeProduct(shop.id),
          otherProduct = await makeProduct(shop.id),
          foreignProduct = await makeProduct(otherShop.id);
        const members = new ShopMembersService(new ShopMembersRepository(tx));
        const service = new ProductVariantsService(
          new ProductVariantsRepository(tx),
          members,
          new TenantResourcesService(
            members,
            new TenantResourcesRepository(tx),
          ),
        );
        const group = (
          await service.createGroup(user.id, shop.id, product.id, {
            name: 'Size',
          })
        ).optionGroup;
        const wrongProductGroup = (
          await service.createGroup(user.id, shop.id, otherProduct.id, {
            name: 'Other Size',
          })
        ).optionGroup;
        const foreignGroup = (
          await service.createGroup(user.id, otherShop.id, foreignProduct.id, {
            name: 'Size',
          })
        ).optionGroup;
        const regular = (
          await service.createVariant(user.id, shop.id, product.id, {
            name: 'Regular',
            priceAdjustment: '0',
            optionGroupId: group.id,
          })
        ).variant;
        const large = (
          await service.createVariant(user.id, shop.id, product.id, {
            name: 'Large',
            priceAdjustment: '30.1',
            optionGroupId: group.id,
          })
        ).variant;
        assert.equal(regular.priceAdjustment, '0.00');
        assert.equal(large.priceAdjustment, '30.10');
        const saved = await tx.productVariant.findFirstOrThrow({
          where: { id: large.id, shopId: shop.id },
        });
        assert.equal(
          product.price.plus(saved.priceAdjustment).toFixed(2),
          '150.10',
        );
        const hot = (
          await service.createVariant(user.id, shop.id, product.id, {
            name: 'Hot',
            priceAdjustment: '0.01',
          })
        ).variant;
        assert.equal(hot.optionGroupId, null);
        assert.equal(
          (
            await service.updateVariant(
              user.id,
              shop.id,
              product.id,
              large.id,
              { priceAdjustment: '0.20', isAvailable: false, sortOrder: 1 },
            )
          ).variant.priceAdjustment,
          '0.20',
        );
        assert.equal(
          (
            await service.updateGroup(user.id, shop.id, product.id, group.id, {
              isRequired: false,
              isAvailable: false,
            })
          ).optionGroup.isRequired,
          false,
        );
        await service.updateVariant(user.id, shop.id, product.id, hot.id, {
          optionGroupId: group.id,
        });
        assert.equal(
          (
            await service.updateVariant(user.id, shop.id, product.id, hot.id, {
              optionGroupId: null,
            })
          ).variant.optionGroupId,
          null,
        );
        const listed = await service.list(user.id, shop.id, product.id);
        assert.equal(listed.variants.length, 3);
        assert.equal(listed.optionGroups.length, 1);
        assert.equal(listed.variants.at(-1).id, large.id);

        // Failed SQL writes abort a transaction; savepoints let subsequent checks continue.
        const rejectedWrite = async (operation, predicate) => {
          await tx.$executeRawUnsafe('SAVEPOINT invalid_variant');
          await assert.rejects(operation, predicate);
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_variant');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_variant');
        };
        for (const optionGroupId of [
          wrongProductGroup.id,
          foreignGroup.id,
          randomUUID(),
        ]) {
          await rejectedWrite(
            () =>
              service.createVariant(user.id, shop.id, product.id, {
                name: 'Invalid',
                priceAdjustment: '1',
                optionGroupId,
              }),
            (error) => error.getStatus() === 404,
          );
          await rejectedWrite(
            () =>
              service.updateVariant(user.id, shop.id, product.id, hot.id, {
                optionGroupId,
              }),
            (error) => error.getStatus() === 404,
          );
        }
        await rejectedWrite(
          () =>
            service.createVariant(user.id, shop.id, product.id, {
              name: 'hot',
              priceAdjustment: '1',
            }),
          (error) => error.getStatus() === 409,
        );
        await rejectedWrite(
          () =>
            service.updateVariant(
              user.id,
              shop.id,
              product.id,
              foreignGroup.id,
              { name: 'Invalid' },
            ),
          (error) => error.getStatus() === 404,
        );
        await assert.rejects(
          () => service.list(user.id, shop.id, foreignProduct.id),
          (error) => error.getStatus() === 404,
        );
        const sqlState = (error) =>
          error.meta?.code ??
          error.meta?.driverAdapterError?.cause?.originalCode;
        for (const price of ['-0.01', 'NaN', '100000000']) {
          await rejectedWrite(
            () =>
              tx.$executeRaw`UPDATE product_variants SET "priceAdjustment" = ${price}::numeric WHERE id = ${hot.id} AND "shopId" = ${shop.id}`,
            (error) => ['23514', '22003'].includes(sqlState(error)),
          );
        }
        await rejectedWrite(
          () =>
            tx.$executeRaw`UPDATE product_variants SET "shopId" = ${otherShop.id} WHERE id = ${hot.id}`,
          (error) => sqlState(error) === '23503',
        );
        await rejectedWrite(
          () =>
            tx.$executeRaw`UPDATE product_option_groups SET "productId" = ${otherProduct.id} WHERE id = ${group.id}`,
          (error) => sqlState(error) === '23503',
        );

        await tx.product.update({
          where: { id: product.id },
          data: { isArchived: true },
        });
        await assert.rejects(
          () => service.list(user.id, shop.id, product.id),
          (error) => error.getStatus() === 404,
        );
        await rejectedWrite(
          () =>
            service.updateVariant(user.id, shop.id, product.id, hot.id, {
              name: 'Changed',
            }),
          (error) => error.getStatus() === 404,
        );
        await tx.product.update({
          where: { id: product.id },
          data: { isArchived: false },
        });
        await tx.shopMember.update({
          where: { userId_shopId: { userId: user.id, shopId: shop.id } },
          data: { role: 'CASHIER' },
        });
        await assert.rejects(
          () => service.list(user.id, shop.id, product.id),
          (error) => error.getStatus() === 403,
        );
        // Bypass service guards to prove the repository repeats live role checks.
        const repo = new ProductVariantsRepository(tx);
        assert.equal(await repo.list(user.id, shop.id, product.id), null);
        await rejectedWrite(
          () =>
            repo.updateVariant(user.id, shop.id, product.id, hot.id, {
              name: 'Changed',
            }),
          (error) => error.code === 'P2025',
        );
        await tx.product.delete({ where: { id: product.id } });
        assert.equal(
          await tx.productVariant.count({
            where: { shopId: shop.id, productId: product.id },
          }),
          0,
        );
        assert.equal(
          await tx.productOptionGroup.count({
            where: { shopId: shop.id, productId: product.id },
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
    'Variant storage, exact surcharges, grouped/ungrouped CRUD, tenant/product links, live access, archive handling, cascade deletion and RLS passed. Fixtures rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
