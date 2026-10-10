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
const rollback = new Error('Intentional custom option fixture rollback');
const email = `custom-options-${randomUUID()}@example.com`;
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash: 'unused' },
        });
        const shop = await tx.shop.create({
          data: {
            name: 'Custom options fixture',
            slug: `custom-options-${randomUUID()}`,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
        });
        const product = await tx.product.create({
          data: {
            shopId: shop.id,
            name: 'Custom drink',
            slug: randomUUID(),
            price: '100.00',
          },
        });
        const otherProduct = await tx.product.create({
          data: {
            shopId: shop.id,
            name: 'Another drink',
            slug: randomUUID(),
            price: '100.00',
          },
        });
        const members = new ShopMembersService(new ShopMembersRepository(tx));
        const repo = new ProductVariantsRepository(tx);
        const service = new ProductVariantsService(
          repo,
          members,
          new TenantResourcesService(
            members,
            new TenantResourcesRepository(tx),
          ),
        );
        const groupRows = [],
          optionRows = [];
        for (const [name, choices] of [
          [
            'Size',
            [
              ['Small', '0'],
              ['Medium', '15.00'],
            ],
          ],
          [
            'Temperature',
            [
              ['Hot', '0'],
              ['Iced', '5.00'],
            ],
          ],
          [
            'Flavor',
            [
              ['Vanilla', '0'],
              ['Hazelnut', '12.50'],
              ['抹茶', '10.00'],
            ],
          ],
          [
            'Serving size',
            [
              ['250 ml', '0'],
              ['500 ml', '20.00'],
            ],
          ],
          [
            'Heat level',
            [
              ['Mild', '0'],
              ['Extra spicy', '0.00'],
            ],
          ],
        ]) {
          const group = (
            await service.createGroup(user.id, shop.id, product.id, {
              name,
              isRequired: name !== 'Flavor',
              sortOrder: groupRows.length,
            })
          ).optionGroup;
          groupRows.push(group);
          for (const [
            sortOrder,
            [choiceName, priceAdjustment],
          ] of choices.entries()) {
            const variant = (
              await service.createVariant(user.id, shop.id, product.id, {
                name: choiceName,
                priceAdjustment,
                isDefault: sortOrder === 0,
                optionGroupId: group.id,
                sortOrder,
              })
            ).variant;
            assert.equal(variant.name, choiceName);
            assert.equal(variant.optionGroupId, group.id);
            assert.equal(variant.isDefault, sortOrder === 0);
            optionRows.push(variant);
          }
        }
        assert.equal(
          new Set(optionRows.map((variant) => variant.id)).size,
          optionRows.length,
        );
        let listed = await service.list(user.id, shop.id, product.id);
        assert.equal(listed.optionGroups.length, 5);
        assert.equal(listed.variants.length, 11);
        assert.deepEqual(
          listed.optionGroups.map((group) => group.name),
          ['Size', 'Temperature', 'Flavor', 'Serving size', 'Heat level'],
        );
        assert.equal(
          listed.optionGroups.find((group) => group.name === 'Flavor')
            .isRequired,
          false,
        );
        const hazelnut = optionRows.find(
          (variant) => variant.name === 'Hazelnut',
        );
        const renamed = (
          await service.updateVariant(
            user.id,
            shop.id,
            product.id,
            hazelnut.id,
            {
              name: 'Salted Caramel',
              priceAdjustment: '13.25',
              isAvailable: false,
            },
          )
        ).variant;
        assert.equal(renamed.id, hazelnut.id);
        assert.equal(renamed.priceAdjustment, '13.25');
        assert.equal(renamed.isAvailable, false);
        await service.updateGroup(
          user.id,
          shop.id,
          product.id,
          groupRows[3].id,
          { name: 'Portion', sortOrder: 8, isRequired: false },
        );
        await service.updateVariant(user.id, shop.id, product.id, hazelnut.id, {
          optionGroupId: groupRows[3].id,
        });
        const ungrouped = (
          await service.createVariant(user.id, shop.id, product.id, {
            name: 'Family serving',
            priceAdjustment: '45.00',
          })
        ).variant;
        assert.equal(ungrouped.optionGroupId, null);
        // The same label can be used in separate groups and on other products.
        await service.createVariant(user.id, shop.id, product.id, {
          name: 'Small',
          priceAdjustment: '0',
          optionGroupId: groupRows[3].id,
        });
        await service.createVariant(user.id, shop.id, otherProduct.id, {
          name: 'Small',
          priceAdjustment: '0',
        });
        const rejectedWrite = async (operation, predicate) => {
          await tx.$executeRawUnsafe('SAVEPOINT invalid_custom_option');
          await assert.rejects(operation, predicate);
          await tx.$executeRawUnsafe(
            'ROLLBACK TO SAVEPOINT invalid_custom_option',
          );
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_custom_option');
        };
        await rejectedWrite(
          () =>
            service.createVariant(user.id, shop.id, product.id, {
              name: 'small',
              priceAdjustment: '0',
              optionGroupId: groupRows[0].id,
            }),
          (error) => error.getStatus() === 409,
        );
        await rejectedWrite(
          () =>
            service.createVariant(user.id, shop.id, otherProduct.id, {
              name: 'Invalid',
              priceAdjustment: '0',
              optionGroupId: groupRows[0].id,
            }),
          (error) => error.getStatus() === 404,
        );
        listed = await service.list(user.id, shop.id, product.id);
        assert.equal(listed.variants.length, 13);
        assert.equal(
          listed.variants.filter((variant) => variant.name === 'Small').length,
          2,
        );
        assert.equal(listed.optionGroups.at(-1).name, 'Portion');
        assert.equal(
          (await service.list(user.id, shop.id, otherProduct.id)).variants
            .length,
          1,
        );
        // Repository predicates still enforce live roles for arbitrary custom options.
        await tx.shopMember.update({
          where: { userId_shopId: { userId: user.id, shopId: shop.id } },
          data: { role: 'CASHIER' },
        });
        assert.equal(await repo.list(user.id, shop.id, product.id), null);
        await assert.rejects(
          () =>
            service.createVariant(user.id, shop.id, product.id, {
              name: 'New flavor',
              priceAdjustment: '0',
            }),
          (error) => error.getStatus() === 403,
        );
        throw rollback;
      },
      { timeout: 90000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  console.log(
    'Custom size, temperature, flavor, serving and arbitrary groups passed with the existing schema; exact surcharges, identity-preserving edits, group isolation and permissions verified. Fixtures rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
