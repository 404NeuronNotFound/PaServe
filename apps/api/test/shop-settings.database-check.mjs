// Run after the API build, from apps/api. All test fixtures are rolled back.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ShopsService } from '../dist/modules/shops/shops.service.js';
import { ShopsRepository } from '../dist/modules/shops/shops.repository.js';

const prisma = new PrismaService();
const marker = randomUUID();
const emails = [
  `settings-a-${marker}@example.com`,
  `settings-b-${marker}@example.com`,
];
const rollback = new Error('Intentional settings fixture rollback');
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const owner = await tx.user.create({
          data: { email: emails[0], passwordHash: 'unused-test-hash' },
        });
        const other = await tx.user.create({
          data: { email: emails[1], passwordHash: 'unused-test-hash' },
        });
        const service = new ShopsService(new ShopsRepository(tx));
        const { shop } = await service.create(owner.id, {
          name: `Settings A ${marker}`,
        });
        const { shop: otherShop } = await service.create(other.id, {
          name: `Settings B ${marker}`,
        });
        await tx.shopMember.create({
          data: { userId: owner.id, shopId: otherShop.id, role: 'CASHIER' },
        });
        const initial = (await service.getSettings(owner.id, shop.id)).shop;
        for (const field of [
          'displayName',
          'phone',
          'contactEmail',
          'website',
          'address',
          'operatingHours',
        ])
          assert.equal(initial[field], null);
        await tx.shop.update({
          where: { id: shop.id },
          data: {
            logoUrl: 'https://example.com/logo.png',
            bannerUrl: 'https://example.com/banner.png',
          },
        });
        const details = {
          name: ' Changed Business ',
          description: ' A friendly cafe ',
          displayName: ' The Cafe ',
          phone: ' +63 123 ',
          contactEmail: ' cafe@example.com ',
          website: ' https://example.com ',
          address: ' Main Street ',
          operatingHours: ' Mon–Fri 8am–6pm ',
        };
        await service.updateSettings(owner.id, shop.id, details);
        const loaded = (await service.getSettings(owner.id, shop.id)).shop;
        for (const [field, value] of Object.entries(details))
          assert.equal(loaded[field], value.trim());
        assert.equal(loaded.slug, shop.slug);
        const branded = await tx.shop.findUnique({ where: { id: shop.id } });
        assert.equal(branded.logoUrl, 'https://example.com/logo.png');
        assert.equal(branded.bannerUrl, 'https://example.com/banner.png');
        await service.updateSettings(owner.id, shop.id, {
          description: ' ',
          displayName: '',
          phone: '',
          contactEmail: '',
          website: '',
          address: '',
          operatingHours: '',
        });
        const cleared = (await service.getSettings(owner.id, shop.id)).shop;
        for (const field of [
          'description',
          'displayName',
          'phone',
          'contactEmail',
          'website',
          'address',
          'operatingHours',
        ])
          assert.equal(cleared[field], null);
        assert.equal(cleared.name, 'Changed Business');
        await assert.rejects(service.getSettings(owner.id, otherShop.id), {
          status: 403,
        });
        await assert.rejects(
          service.updateSettings(owner.id, otherShop.id, {
            phone: 'wrong target',
          }),
          { status: 403 },
        );
        assert.equal(
          (await service.getSettings(other.id, otherShop.id)).shop.phone,
          null,
        );
        // Repeat authorization at the database operation, after a previously valid read.
        await tx.shopMember.update({
          where: { userId_shopId: { userId: owner.id, shopId: shop.id } },
          data: { role: 'MANAGER' },
        });
        await assert.rejects(service.getSettings(owner.id, shop.id), {
          status: 403,
        });
        await assert.rejects(
          service.updateSettings(owner.id, shop.id, { name: 'Forbidden' }),
          { status: 403 },
        );
        assert.equal(
          (await tx.shop.findUnique({ where: { id: shop.id } })).name,
          'Changed Business',
        );
        const [security] =
          await tx.$queryRaw`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.shops'::regclass`;
        assert.equal(security.relrowsecurity, true);
        for (const role of ['anon', 'authenticated']) {
          const [privilege] =
            await tx.$queryRaw`SELECT has_table_privilege(${role}, 'public.shops', 'SELECT,INSERT,UPDATE,DELETE') AS allowed`;
          assert.equal(privilege.allowed, false);
        }
        console.log(
          'Verified defaults, real save/reload, normalization, clearing, stable slug/branding, cross-shop isolation, ownership changes and shop RLS.',
        );
        throw rollback;
      },
      { timeout: 60000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(
    await prisma.user.count({ where: { email: { in: emails } } }),
    0,
  );
  console.log(
    'All settings fixtures rolled back; no existing shop data changed.',
  );
} finally {
  await prisma.$disconnect();
}
