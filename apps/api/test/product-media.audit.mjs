// Run from apps/api after building. Read-only audit: no database or storage mutations.
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ProductImageStorage } from '../dist/modules/products/product-image.storage.js';
import { ProductImageProcessor } from '../dist/modules/products/product-image.processor.js';

const prisma = new PrismaService();
const storage = new ProductImageStorage(new ConfigService());
const processor = new ProductImageProcessor();
const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
try {
  const products = await prisma.product.findMany({
    where: { imageUrl: { not: null } },
    select: { id: true, shopId: true, imageUrl: true },
  });
  const invalid = [],
    uncertain = [];
  for (const product of products) {
    const owned = storage.ownedReference(
      product.shopId,
      product.id,
      product.imageUrl,
    );
    if (!owned) {
      invalid.push({
        ...product,
        reason: 'External, foreign-resource or noncanonical URL',
      });
      continue;
    }
    const { data, error } = await admin.storage
      .from(owned.bucketName)
      .download(owned.storagePath);
    if (error) {
      if (
        String(error.statusCode ?? error.status) === '404' ||
        /object not found|not_found|no such key/i.test(error.message)
      )
        invalid.push({ ...product, reason: 'Object missing' });
      else
        uncertain.push({
          id: product.id,
          shopId: product.shopId,
          reason: 'Storage check unavailable; reference preserved',
        });
      continue;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    try {
      await processor.process({
        buffer,
        size: buffer.length,
        mimetype: 'image/webp',
      });
    } catch {
      invalid.push({ ...product, reason: 'Object failed image validation' });
    }
  }
  const directory = resolve('.tmp');
  await mkdir(directory, { recursive: true });
  const report = resolve(directory, `product-media-audit-${randomUUID()}.json`);
  await writeFile(
    report,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        checked: products.length,
        invalid,
        uncertain,
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      checked: products.length,
      invalid: invalid.length,
      uncertain: uncertain.length,
      report,
    }),
  );
  if (uncertain.length || invalid.length) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
