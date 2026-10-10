// Run from apps/api after build and migration. Fixtures are rolled back.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ShopsService } from '../dist/modules/shops/shops.service.js';
import { ShopsRepository } from '../dist/modules/shops/shops.repository.js';
import { PublicMenuRepository } from '../dist/modules/categories/public-menu.repository.js';

const prisma = new PrismaService();
const marker = randomUUID();
const rollback = new Error('Intentional layout fixture rollback');
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const owner = await tx.user.create({
          data: {
            email: `layout-a-${marker}@example.com`,
            passwordHash: 'unused',
          },
        });
        const other = await tx.user.create({
          data: {
            email: `layout-b-${marker}@example.com`,
            passwordHash: 'unused',
          },
        });
        const service = new ShopsService(new ShopsRepository(tx));
        const { shop } = await service.create(owner.id, {
          name: `Layout A ${marker}`,
        });
        const { shop: otherShop } = await service.create(other.id, {
          name: `Layout B ${marker}`,
        });
        assert.equal(
          (await service.getSettings(owner.id, shop.id)).shop.menuLayout,
          'list',
        );
        const category = await tx.category.create({
          data: { shopId: shop.id, name: 'Drinks', slug: 'drinks' },
        });
        await tx.product.create({
          data: {
            shopId: shop.id,
            categoryId: category.id,
            name: 'Coffee',
            slug: 'coffee',
            price: '20.00',
          },
        });
        const publicMenu = new PublicMenuRepository(tx);
        const initial = await publicMenu.read(shop.slug);
        for (const menuLayout of ['grid', 'compact', 'list']) {
          await service.updateSettings(owner.id, shop.id, { menuLayout });
          assert.equal(
            (await service.getSettings(owner.id, shop.id)).shop.menuLayout,
            menuLayout,
          );
          const loaded = await publicMenu.read(shop.slug);
          assert.equal(loaded.menuLayout, menuLayout);
          assert.deepEqual(loaded.categories, initial.categories);
          assert.deepEqual(loaded.products, initial.products);
          assert.equal(
            await tx.product.count({ where: { shopId: shop.id } }),
            1,
          );
          assert.equal(
            (await service.getSettings(other.id, otherShop.id)).shop.menuLayout,
            'list',
          );
        }
        await assert.rejects(
          service.updateSettings(owner.id, otherShop.id, {
            menuLayout: 'grid',
          }),
          { status: 403 },
        );
        await tx.$executeRawUnsafe('SAVEPOINT invalid_layout');
        await assert.rejects(
          tx.$executeRaw`UPDATE "shops" SET "menuLayout" = ${'unsupported'}::"MenuLayout" WHERE id = ${shop.id}::uuid`,
        );
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_layout');
        assert.equal(
          (await service.getSettings(owner.id, shop.id)).shop.menuLayout,
          'list',
        );
        throw rollback;
      },
      { timeout: 30000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(
    await prisma.user.count({ where: { email: { contains: marker } } }),
    0,
  );
  console.log(
    'Menu layout: defaults, persistence, public exposure, unchanged items, isolation, database validation and cleanup passed.',
  );
} finally {
  await prisma.$disconnect();
}
