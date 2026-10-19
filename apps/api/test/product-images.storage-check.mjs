// Run from apps/api after building and applying the Phase 23 paserve-assets migration.
import 'dotenv/config';
import { assertBrowserCannotChangeObject } from './storage-browser-check.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ProductsRepository } from '../dist/modules/products/products.repository.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { TenantResourcesService } from '../dist/modules/tenancy/tenant-resources.service.js';
import { TenantResourcesRepository } from '../dist/modules/tenancy/tenant-resources.repository.js';
import { ProductImageProcessor } from '../dist/modules/products/product-image.processor.js';
import {
  ProductImageStorage,
  PRODUCT_IMAGE_BUCKET,
} from '../dist/modules/products/product-image.storage.js';
import { ProductImageService } from '../dist/modules/products/product-image.service.js';
const prisma = new PrismaService(),
  storage = new ProductImageStorage(new ConfigService());
const paths = [],
  email = `image-check-${randomUUID()}@example.com`,
  rollback = new Error('Intentional image fixture rollback');
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash: 'unused' },
        });
        const shop = await tx.shop.create({
          data: {
            name: 'Image fixture',
            slug: `image-check-${randomUUID()}`,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
        });
        const product = await tx.product.create({
          data: {
            shopId: shop.id,
            name: 'Coffee',
            slug: 'coffee',
            price: '12.50',
          },
        });
        // Membership in both shops never permits mixing a shop and another shop's product.
        const otherShop = await tx.shop.create({
          data: {
            name: 'Other image fixture',
            slug: `image-other-${randomUUID()}`,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
        });
        const otherProduct = await tx.product.create({
          data: {
            shopId: otherShop.id,
            name: 'Other coffee',
            slug: 'other-coffee',
            price: '9.50',
          },
        });
        const members = new ShopMembersService(new ShopMembersRepository(tx));
        const service = new ProductImageService(
          new ProductsRepository(tx),
          members,
          new TenantResourcesService(
            members,
            new TenantResourcesRepository(tx),
          ),
          new ProductImageProcessor(),
          storage,
        );
        const buffer = await sharp({
          create: { width: 2, height: 2, channels: 3, background: 'red' },
        })
          .png()
          .toBuffer();
        const file = { buffer, size: buffer.length, mimetype: 'image/png' };
        await assert.rejects(
          service.upload(user.id, shop.id, otherProduct.id, file),
          (error) => error.getStatus?.() === 404,
        );
        await assert.rejects(
          service.upload(user.id, otherShop.id, product.id, file),
          (error) => error.getStatus?.() === 404,
        );
        assert.equal(
          (
            await tx.product.findUniqueOrThrow({
              where: { id: otherProduct.id },
            })
          ).imageUrl,
          null,
        );
        const first = await service.upload(user.id, shop.id, product.id, file);
        paths.push(first.storagePath);
        const admin = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
        );
        assert.equal(
          first.product.imageUrl,
          admin.storage
            .from(PRODUCT_IMAGE_BUCKET)
            .getPublicUrl(first.storagePath).data.publicUrl,
        );
        assert.ok(
          first.storagePath.startsWith(
            `shops/${shop.id}/products/${product.id}/`,
          ),
        );
        const saved = await tx.product.findFirstOrThrow({
          where: { id: product.id, shopId: shop.id },
        });
        assert.equal(saved.imageUrl, first.product.imageUrl);
        assert.equal(saved.price.toFixed(2), '12.50');
        const response = await fetch(first.product.imageUrl);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /image\/webp/);
        assert.equal(
          (await sharp(Buffer.from(await response.arrayBuffer())).metadata())
            .format,
          'webp',
        );
        const second = await service.upload(user.id, shop.id, product.id, file);
        paths.push(second.storagePath);
        assert.ok(
          second.storagePath.startsWith(
            `shops/${shop.id}/products/${product.id}/`,
          ),
        );
        assert.equal(
          second.product.imageUrl,
          admin.storage
            .from(PRODUCT_IMAGE_BUCKET)
            .getPublicUrl(second.storagePath).data.publicUrl,
        );
        assert.equal((await fetch(second.product.imageUrl)).status, 200);
        assert.notEqual(first.storagePath, second.storagePath);
        assert.equal(
          (
            await tx.product.findFirstOrThrow({
              where: { id: product.id, shopId: shop.id },
            })
          ).imageUrl,
          second.product.imageUrl,
        );
        assert.equal((await fetch(first.product.imageUrl)).status, 200);
        await assertBrowserCannotChangeObject(
          tx,
          PRODUCT_IMAGE_BUCKET,
          second.storagePath,
        );
        for (const role of ['anon', 'authenticated']) {
          await tx.$executeRawUnsafe('SAVEPOINT browser_write');
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
          await assert.rejects(
            tx.$executeRaw`INSERT INTO storage.objects (bucket_id, name) VALUES ('paserve-assets', 'browser-write-fixture')`,
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
    'Live product image upload, URL persistence, public delivery, cross-shop rejection, replacement retention and browser-write isolation passed.',
  );
} finally {
  for (const path of paths) await storage.remove(path);
  if (paths.length) {
    const admin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    for (const path of paths) {
      const split = path.lastIndexOf('/');
      const { data, error } = await admin.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .list(path.slice(0, split), { search: path.slice(split + 1) });
      assert.equal(error, null);
      assert.equal(
        data.some((item) => item.name === path.slice(split + 1)),
        false,
      );
    }
    console.log(
      'Image test fixtures rolled back and uploaded objects removed.',
    );
  }
  await prisma.$disconnect();
}
