import { ConfigService } from '@nestjs/config';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { ProductImageStorage } from '../../src/modules/products/product-image.storage.js';
import { ProductImageProcessor } from '../../src/modules/products/product-image.processor.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { id, type ImageEntry } from './plan.js';
import { businesses } from './catalog.js';
import { ShopLogoStorage } from '../../src/modules/shops/shop-logo.storage.js';
import { ShopBannerStorage } from '../../src/modules/shops/shop-banner.storage.js';

export async function uploadBranding(prisma: PrismaClient) {
  const config = new ConfigService(process.env);
  const logos = new ShopLogoStorage(config);
  const banners = new ShopBannerStorage(config);
  let uploaded = 0;
  for (const business of businesses) {
    const shopId = id(business.slug);
    const shop = await prisma.shop.findFirst({
      where: { id: shopId, slug: business.slug },
    });
    if (!shop) throw new Error('Demo branding tenant not found.');
    for (const kind of ['logo', 'banner'] as const) {
      const current = kind === 'logo' ? shop.logoUrl : shop.bannerUrl;
      if (
        current?.startsWith(
          `${process.env.SUPABASE_URL}/storage/v1/object/public/paserve-assets/shops/${shopId}/branding/${kind}/`,
        )
      )
        continue;
      try {
        const buffer = await sharp(
          resolve('../web/public/demo-assets', `${business.slug}-${kind}.svg`),
        )
          .webp({ quality: 85 })
          .toBuffer();
        if (kind === 'logo') {
          const image = await logos.upload(shopId, buffer);
          try {
            await prisma.shop.update({
              where: { id: shopId, slug: business.slug },
              data: { logoUrl: image.logoUrl },
            });
          } catch (error) {
            await logos.remove(image.storagePath);
            throw error;
          }
        } else {
          const image = await banners.upload(shopId, buffer);
          try {
            await prisma.shop.update({
              where: { id: shopId, slug: business.slug },
              data: { bannerUrl: image.bannerUrl },
            });
          } catch (error) {
            await banners.remove(image.storagePath);
            throw error;
          }
        }
        uploaded++;
      } catch {
        /* The checked-in brand SVG remains usable when Storage is offline. */
      }
    }
  }
  return uploaded;
}

export const assetsDir = resolve('seed-assets');
export const manifestPath = resolve(assetsDir, 'product-image-manifest.json');
export async function saveManifest(entries: ImageEntry[]) {
  await mkdir(assetsDir, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(entries, null, 2) + '\n');
}

/** Best-effort media writes follow committed DB records. Failed uploads retain local fallbacks. */
export async function uploadImages(
  prisma: PrismaClient,
  entries: ImageEntry[],
  generated: boolean,
) {
  const storage = new ProductImageStorage(new ConfigService(process.env));
  const processor = new ProductImageProcessor();
  let uploaded = 0,
    failures = 0;
  const queue = [...entries];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      while (queue.length) {
        const entry = queue.shift()!;
        if (
          !businesses.some((business) => id(business.slug) === entry.shopId) ||
          !/^[a-z0-9-]+\.webp$/.test(entry.filename) ||
          !/^[0-9a-f-]{36}$/.test(entry.productId) ||
          ![
            'coffee',
            'tea',
            'milk-tea',
            'pastry',
            'meal',
            'dessert',
            'sandwich',
            'juice',
          ].includes(entry.kind)
        )
          throw new Error('Invalid demo manifest identity.');
        const product = await prisma.product.findFirst({
          where: {
            id: entry.productId,
            shopId: entry.shopId,
            name: entry.productName,
          },
          select: { id: true, imageUrl: true },
        });
        if (!product)
          throw new Error('Manifest product does not match the demo tenant.');
        if (
          generated &&
          entry.status === 'uploaded' &&
          entry.imageUrl === product.imageUrl &&
          product.imageUrl?.startsWith(
            `${process.env.SUPABASE_URL}/storage/v1/object/public/paserve-assets/shops/${entry.shopId}/products/${entry.productId}/`,
          )
        )
          continue;
        const path = generated
          ? resolve(
              assetsDir,
              'generated',
              entry.shopId,
              entry.productId,
              entry.filename,
            )
          : resolve('../web/public/demo-assets', `${entry.kind}.svg`);
        let source: Buffer;
        try {
          source = await readFile(path);
        } catch {
          if (generated) {
            try {
              source = await readFile(
                resolve('prisma/demo/assets', entry.filename),
              );
            } catch {
              continue;
            }
          } else throw new Error('Missing checked-in category fallback.');
        }
        if (
          !process.env.SUPABASE_URL ||
          !process.env.SUPABASE_SERVICE_ROLE_KEY
        ) {
          failures++;
          continue;
        }
        let reference: { storagePath: string; imageUrl: string } | undefined;
        try {
          const buffer = generated
            ? await processor.process({
                buffer: source,
                mimetype: 'image/webp',
                size: source.length,
                originalname: entry.filename,
              })
            : await sharp(source)
                .resize(512, 512)
                .webp({ quality: 85 })
                .toBuffer();
          reference = await storage.upload(
            entry.shopId,
            entry.productId,
            buffer,
          );
          const updated = await prisma.product.updateMany({
            where: { id: entry.productId, shopId: entry.shopId },
            data: { imageUrl: reference.imageUrl },
          });
          if (updated.count !== 1)
            throw new Error('Image tenant update failed.');
          if (generated) {
            entry.status = 'uploaded';
            entry.imageUrl = reference.imageUrl;
            entry.storagePath = reference.storagePath;
          } else entry.fallbackUrl = reference.imageUrl;
          uploaded++;
        } catch {
          if (reference) await storage.remove(reference.storagePath);
          failures++;
        }
      }
    }),
  );
  await saveManifest(entries);
  return {
    uploaded,
    failures,
    pending: entries.filter((entry) => entry.status === 'pending').length,
  };
}
