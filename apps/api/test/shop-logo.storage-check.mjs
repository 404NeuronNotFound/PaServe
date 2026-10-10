// Run from apps/api after building and applying the logo bucket migration.
// Database fixtures roll back; only generated fixture objects are removed.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ShopsRepository } from '../dist/modules/shops/shops.repository.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { ShopLogoProcessor } from '../dist/modules/shops/shop-logo.processor.js';
import {
  ShopLogoStorage,
  SHOP_LOGO_BUCKET,
} from '../dist/modules/shops/shop-logo.storage.js';
import { ShopLogoService } from '../dist/modules/shops/shop-logo.service.js';
import { PublicMenuRepository } from '../dist/modules/categories/public-menu.repository.js';

const prisma = new PrismaService();
const storage = new ShopLogoStorage(new ConfigService());
const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const marker = randomUUID(),
  email = `logo-check-${marker}@example.com`;
const paths = [];
const rollback = new Error('Intentional logo fixture rollback');
async function exists(path) {
  const split = path.lastIndexOf('/');
  const { data, error } = await admin.storage
    .from(SHOP_LOGO_BUCKET)
    .list(path.slice(0, split), { search: path.slice(split + 1) });
  assert.equal(error, null);
  return data.some((item) => item.name === path.slice(split + 1));
}
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash: 'unused-fixture-hash' },
        });
        const shop = await tx.shop.create({
          data: {
            name: 'Logo fixture cafe',
            slug: `logo-fixture-${marker}`,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
        });
        const members = new ShopMembersService(new ShopMembersRepository(tx));
        const repository = new ShopsRepository(tx);
        const service = new ShopLogoService(
          repository,
          members,
          new ShopLogoProcessor(),
          storage,
        );
        const buffer = await sharp({
          create: {
            width: 1000,
            height: 500,
            channels: 4,
            background: { r: 100, g: 150, b: 0, alpha: 0.5 },
          },
        })
          .png()
          .toBuffer();
        const file = { buffer, size: buffer.length, mimetype: 'image/png' };
        const first = await service.upload(user.id, shop.id, file);
        paths.push(first.storagePath);
        assert.ok(first.storagePath.startsWith(`${shop.id}/logo/`));
        const response = await fetch(first.shop.logoUrl);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /image\/webp/);
        assert.deepEqual(
          await sharp(Buffer.from(await response.arrayBuffer()))
            .metadata()
            .then(({ width, height, hasAlpha }) => ({
              width,
              height,
              hasAlpha,
            })),
          { width: 512, height: 256, hasAlpha: true },
        );
        assert.equal(
          (await repository.findSettings(user.id, shop.id)).logoUrl,
          first.shop.logoUrl,
        );
        assert.equal(
          (await members.requireMembership(user.id, shop.id)).shop.logoUrl,
          first.shop.logoUrl,
        );
        assert.equal(
          (await new PublicMenuRepository(tx).read(shop.slug)).logoUrl,
          first.shop.logoUrl,
        );
        const second = await service.upload(user.id, shop.id, file);
        paths.push(second.storagePath);
        assert.notEqual(first.shop.logoUrl, second.shop.logoUrl);
        assert.equal(
          (await repository.findSettings(user.id, shop.id)).logoUrl,
          second.shop.logoUrl,
        );
        assert.equal(
          (await new PublicMenuRepository(tx).read(shop.slug)).logoUrl,
          second.shop.logoUrl,
        );
        assert.equal(await exists(first.storagePath), false);
        assert.equal(await exists(second.storagePath), true);
        // Cleanup never accepts another shop's URL or arbitrary external media.
        await storage.removePrevious(randomUUID(), second.shop.logoUrl);
        await storage.removePrevious(
          shop.id,
          'https://example.com/external-logo.webp',
        );
        assert.equal(await exists(second.storagePath), true);
        const [bucket] =
          await tx.$queryRaw`SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'shop-media'`;
        assert.equal(bucket.public, true);
        assert.equal(Number(bucket.file_size_limit), 5242880);
        assert.deepEqual(bucket.allowed_mime_types, ['image/webp']);
        for (const role of ['anon', 'authenticated']) {
          await tx.$executeRawUnsafe('SAVEPOINT browser_write');
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
          await assert.rejects(
            tx.$executeRaw`INSERT INTO storage.objects (bucket_id, name) VALUES ('shop-media', 'browser-logo-fixture')`,
            (error) =>
              (error.meta?.code ??
                error.meta?.driverAdapterError?.cause?.originalCode) ===
              '42501',
          );
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT browser_write');
        }
        throw rollback;
      },
      { timeout: 120000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  console.log(
    'Live logo upload, public delivery, transparent resizing, persistence, replacement cleanup and storage isolation passed.',
  );
} finally {
  for (const path of paths) {
    await storage.remove(path);
    assert.equal(await exists(path), false);
  }
  await prisma.$disconnect();
  console.log(
    'Logo database fixtures rolled back and generated storage objects removed.',
  );
}
