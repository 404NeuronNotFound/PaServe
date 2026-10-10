import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { ProductsRepository } from '../dist/modules/products/products.repository.js';
import { ProductsService } from '../dist/modules/products/products.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { TenantResourcesService } from '../dist/modules/tenancy/tenant-resources.service.js';
import { TenantResourcesRepository } from '../dist/modules/tenancy/tenant-resources.repository.js';

const prisma = new PrismaService();
const rollback = new Error('Intentional price fixture rollback');
const email = `price-check-${randomUUID()}@example.com`;
try {
  const columns = await prisma.$queryRaw`
    SELECT data_type, numeric_precision, numeric_scale FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'price'`;
  assert.equal(columns[0].data_type, 'numeric');
  assert.equal(columns[0].numeric_precision, 10);
  assert.equal(columns[0].numeric_scale, 2);
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash: 'unused' },
        });
        const shop = await tx.shop.create({
          data: {
            name: 'Price fixture',
            slug: `price-check-${randomUUID()}`,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
        });
        const members = new ShopMembersService(new ShopMembersRepository(tx));
        const service = new ProductsService(
          new ProductsRepository(tx),
          members,
          new TenantResourcesService(
            members,
            new TenantResourcesRepository(tx),
          ),
        );
        for (const [price, expected] of [
          ['0', '0.00'],
          ['0.1', '0.10'],
          ['0.01', '0.01'],
          ['99999999.99', '99999999.99'],
        ]) {
          const result = await service.create(user.id, shop.id, {
            name: `Price ${price}`,
            price,
          });
          assert.equal(result.product.price, expected);
          const saved = await tx.product.findFirstOrThrow({
            where: { id: result.product.id, shopId: shop.id },
          });
          assert.equal(saved.price.toFixed(2), expected);
          assert.equal(
            saved.price.plus('0.2').minus('0.2').toFixed(2),
            expected,
          );
          const edited = await service.update(user.id, shop.id, saved.id, {
            price: '0.3',
          });
          assert.equal(edited.product.price, '0.30');
          assert.equal(
            new Prisma.Decimal('0.1').plus('0.2').toFixed(2),
            '0.30',
          );
        }
        const product = (await service.list(user.id, shop.id)).products[0];
        for (const value of ['-0.01', 'NaN', '100000000']) {
          await tx.$executeRawUnsafe('SAVEPOINT invalid_price');
          await assert.rejects(
            tx.$executeRaw`
        UPDATE products SET price = ${value}::numeric WHERE id = ${product.id} AND "shopId" = ${shop.id}`,
            (error) =>
              ['23514', '22003'].includes(
                error.meta?.code ??
                  error.meta?.driverAdapterError?.cause?.originalCode,
              ),
          );
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_price');
        }
        throw rollback;
      },
      { timeout: 60000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  console.log(
    'Decimal storage, exact cent values, create/edit serialization, nonnegative/NaN/overflow constraints passed. Fixtures rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
