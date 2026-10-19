// Run from apps/api after building. Read-only audit of existing logo/banner references.
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { PrismaService } from '../dist/database/prisma.service.js';
import {
  ASSETS_BUCKET,
  brandingFolder,
} from '../dist/common/storage/media-paths.js';
import { ShopLogoProcessor } from '../dist/modules/shops/shop-logo.processor.js';
import { ShopBannerProcessor } from '../dist/modules/shops/shop-banner.processor.js';

const prisma = new PrismaService();
const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const processors = {
  logo: new ShopLogoProcessor(),
  banner: new ShopBannerProcessor(),
};
try {
  const shops = await prisma.shop.findMany({
    where: { OR: [{ logoUrl: { not: null } }, { bannerUrl: { not: null } }] },
    select: { id: true, logoUrl: true, bannerUrl: true },
  });
  const invalid = [],
    uncertain = [];
  let checked = 0;
  for (const shop of shops)
    for (const kind of ['logo', 'banner']) {
      const url = shop[kind + 'Url'];
      if (!url) continue;
      checked++;
      let owned;
      for (const [bucket, folder] of [
        [ASSETS_BUCKET, brandingFolder(shop.id, kind)],
        ['shop-media', `${shop.id}/${kind}/`],
      ]) {
        const prefix = admin.storage.from(bucket).getPublicUrl(folder)
          .data.publicUrl;
        if (!url.startsWith(prefix)) continue;
        const filename = url.slice(prefix.length);
        if (
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/.test(
            filename,
          )
        )
          owned = { bucket, path: folder + filename };
      }
      if (!owned) {
        invalid.push({
          shopId: shop.id,
          kind,
          reason: 'Foreign or noncanonical reference',
        });
        continue;
      }
      const { data, error } = await admin.storage
        .from(owned.bucket)
        .download(owned.path);
      if (error) {
        const missing =
          String(error.statusCode ?? error.status) === '404' ||
          /object not found|not_found|no such key/i.test(error.message);
        (missing ? invalid : uncertain).push({
          shopId: shop.id,
          kind,
          reason: missing ? 'Object missing' : 'Storage check unavailable',
        });
        continue;
      }
      const buffer = Buffer.from(await data.arrayBuffer());
      try {
        await processors[kind].process({
          buffer,
          size: buffer.length,
          mimetype: 'image/webp',
        });
      } catch {
        invalid.push({
          shopId: shop.id,
          kind,
          reason: 'Object failed image validation',
        });
      }
    }
  const directory = resolve('.tmp');
  await mkdir(directory, { recursive: true });
  const report = resolve(
    directory,
    `branding-media-audit-${randomUUID()}.json`,
  );
  await writeFile(
    report,
    JSON.stringify(
      { checkedAt: new Date().toISOString(), checked, invalid, uncertain },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      checked,
      invalid: invalid.length,
      uncertain: uncertain.length,
      report,
    }),
  );
  if (invalid.length || uncertain.length) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
