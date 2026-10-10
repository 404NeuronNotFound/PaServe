// Run from apps/api after build and migration. All fixtures are rolled back.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ShopsService } from '../dist/modules/shops/shops.service.js';
import { ShopsRepository } from '../dist/modules/shops/shops.repository.js';
import { PublicMenuRepository } from '../dist/modules/categories/public-menu.repository.js';

const prisma = new PrismaService();
const marker = randomUUID();
const rollback = new Error('Intentional color fixture rollback');
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const owner = await tx.user.create({
          data: {
            email: `color-a-${marker}@example.com`,
            passwordHash: 'unused',
          },
        });
        const other = await tx.user.create({
          data: {
            email: `color-b-${marker}@example.com`,
            passwordHash: 'unused',
          },
        });
        const service = new ShopsService(new ShopsRepository(tx));
        const { shop } = await service.create(owner.id, {
          name: `Color A ${marker}`,
        });
        const { shop: otherShop } = await service.create(other.id, {
          name: `Color B ${marker}`,
        });
        assert.equal(
          (await service.getSettings(owner.id, shop.id)).shop.primaryColor,
          null,
        );
        await service.updateSettings(owner.id, shop.id, {
          primaryColor: ' #ab12ef ',
        });
        assert.equal(
          (await service.getSettings(owner.id, shop.id)).shop.primaryColor,
          '#AB12EF',
        );
        assert.equal(
          (await new PublicMenuRepository(tx).read(shop.slug)).primaryColor,
          '#AB12EF',
        );
        assert.equal(
          (await service.getSettings(other.id, otherShop.id)).shop.primaryColor,
          null,
        );
        await tx.$executeRawUnsafe('SAVEPOINT color_access');
        await assert.rejects(
          service.updateSettings(owner.id, otherShop.id, {
            primaryColor: '#123456',
          }),
          { status: 403 },
        );
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT color_access');
        await tx.$executeRawUnsafe('SAVEPOINT invalid_color');
        await assert.rejects(
          tx.shop.update({
            where: { id: shop.id },
            data: { primaryColor: '#abc' },
          }),
        );
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_color');
        assert.equal(
          (await service.getSettings(owner.id, shop.id)).shop.primaryColor,
          '#AB12EF',
        );
        await service.updateSettings(owner.id, shop.id, { primaryColor: '' });
        assert.equal(
          (await service.getSettings(owner.id, shop.id)).shop.primaryColor,
          null,
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
    'Primary color: persistence, public exposure, isolation, constraint, reset and fixture cleanup passed.',
  );
} finally {
  await prisma.$disconnect();
}
