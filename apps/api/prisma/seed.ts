import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hash, argon2id } from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { buildPlan, PASSWORD, type ImageEntry } from './demo/plan.js';
import { assertDemoSafety } from './demo/safety.js';
import { persistShop, verifyShop } from './demo/persist.js';
import {
  assetsDir,
  manifestPath,
  saveManifest,
  uploadImages,
  uploadBranding,
} from './demo/images.js';

async function main() {
  const args = new Set(process.argv.slice(2));
  const allowed = ['--dry-run', '--reset-demo', '--upload-images', '--verify'];
  if ([...args].some((arg) => !allowed.includes(arg)) || args.size > 1)
    throw new Error(
      'Choose one of --dry-run, --reset-demo, --upload-images, --verify, or no argument.',
    );
  const now = process.env.DEMO_SEED_NOW
    ? new Date(process.env.DEMO_SEED_NOW)
    : new Date();
  const seed = Number(process.env.DEMO_SEED_RANDOM ?? 20261022);
  if (!Number.isSafeInteger(seed))
    throw new Error('DEMO_SEED_RANDOM must be an integer.');
  const plan = buildPlan(
    now,
    args.has('--dry-run')
      ? 'dry-run-only'
      : await hash(PASSWORD, { type: argon2id }),
    seed,
  );
  if (args.has('--dry-run')) {
    await mkdir(assetsDir, { recursive: true });
    await writeFile(
      resolve(assetsDir, 'preview.json'),
      JSON.stringify(
        {
          now: plan.now,
          started: plan.started,
          seed,
          shops: plan.shops.map((s) => ({
            shop: s.shop.name,
            users: s.users.length,
            products: s.products.length,
            variants: s.variants.length,
            orders: s.orders.length,
            items: s.items.length,
          })),
          images: plan.manifest.length,
        },
        null,
        2,
      ),
    );
    await writeFile(
      resolve(assetsDir, 'product-image-manifest.preview.json'),
      JSON.stringify(plan.manifest, null, 2),
    );
    console.log(
      'Dry run completed. No database or storage connections. See seed-assets/preview.json.',
    );
    return;
  }
  const target = assertDemoSafety(process.env);
  console.log(`Development database target: ${target}`);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 15000,
    }),
  });
  try {
    if (args.has('--upload-images')) {
      const entries = JSON.parse(
        await readFile(manifestPath, 'utf8'),
      ) as ImageEntry[];
      console.log({
        brandingUploaded: await uploadBranding(prisma),
        ...(await uploadImages(prisma, entries, true)),
      });
      return;
    }
    if (args.has('--verify')) {
      // Verification uses the original run date/seed so counts are stable on later days.
      const metadata = JSON.parse(
        await readFile(resolve(assetsDir, 'run.json'), 'utf8'),
      ) as { now: string; seed: number };
      const original = buildPlan(new Date(metadata.now), '', metadata.seed);
      for (const shop of original.shops)
        console.log(
          await prisma.$transaction((tx) => verifyShop(tx, shop), {
            timeout: 60000,
          }),
        );
      return;
    }
    const shopIds = plan.shops.map((s) => s.shop.id);
    const userIds = plan.shops.flatMap((s) => s.users.map((u) => u.id));
    await prisma.$transaction(
      async (tx) => {
        // Concurrent runs serialize. All five shops commit together or all roll back.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261022, 74591)`;
        const existing = await tx.shop.findMany({
          where: {
            OR: [
              { id: { in: shopIds } },
              { slug: { in: plan.shops.map((s) => s.shop.slug) } },
            ],
          },
          select: { id: true, slug: true },
        });
        if (existing.length && !args.has('--reset-demo'))
          throw new Error(
            'Demo shops already exist. Use --reset-demo to replace only these five demo tenants.',
          );
        if (
          existing.some(
            (shop) =>
              !plan.shops.some(
                (s) => s.shop.id === shop.id && s.shop.slug === shop.slug,
              ),
          )
        )
          throw new Error('Demo namespace collision. Refusing to overwrite.');
        if (args.has('--reset-demo')) {
          const shared = await tx.shopMember.count({
            where: { userId: { in: userIds }, shopId: { notIn: shopIds } },
          });
          if (shared)
            throw new Error(
              'Demo users joined other businesses; refusing to reset shared identities.',
            );
          await tx.order.deleteMany({ where: { shopId: { in: shopIds } } });
          await tx.shop.deleteMany({ where: { id: { in: shopIds } } });
          await tx.user.deleteMany({
            where: {
              id: { in: userIds },
              email: {
                in: plan.shops.flatMap((s) => s.users.map((u) => u.email)),
              },
            },
          });
        }
        for (const shop of plan.shops) {
          console.log(
            `Creating ${shop.shop.name}: ${shop.orders.length} orders...`,
          );
          await persistShop(tx, shop);
          console.log(await verifyShop(tx, shop));
        }
      },
      { timeout: 300000, maxWait: 15000 },
    );
    await saveManifest(plan.manifest);
    await writeFile(
      resolve(assetsDir, 'run.json'),
      JSON.stringify({ now: plan.now, seed: plan.seed }, null, 2),
    );
    console.log('Uploading category fallbacks to paserve-assets...');
    const brandingUploaded = await uploadBranding(prisma);
    const images = await uploadImages(prisma, plan.manifest, false);
    const photos = await uploadImages(prisma, plan.manifest, true);
    const totals = plan.shops.reduce(
      (sum, s) => ({
        shops: sum.shops + 1,
        users: sum.users + s.users.length,
        categories: sum.categories + s.categories.length,
        products: sum.products + s.products.length,
        variants: sum.variants + s.variants.length,
        addOnRelationships: sum.addOnRelationships + s.links.length,
        tables: sum.tables + s.tables.length,
        orders: sum.orders + s.orders.length,
        items: sum.items + s.items.length,
        payments: sum.payments + s.timelines.length,
      }),
      {
        shops: 0,
        users: 0,
        categories: 0,
        products: 0,
        variants: 0,
        addOnRelationships: 0,
        tables: 0,
        orders: 0,
        items: 0,
        payments: 0,
      },
    );
    const summary = {
      ...totals,
      historicalRange: [plan.started, plan.now],
      images: {
        brandingUploaded,
        prompts: plan.manifest.length,
        generated: plan.manifest.filter((entry) => entry.status === 'uploaded')
          .length,
        uploadedProductPhotos: photos.uploaded,
        uploadedFallbacks: images.uploaded,
        localFallbacks: images.failures,
        pending: photos.pending,
      },
    };
    await writeFile(
      resolve(assetsDir, 'summary.json'),
      JSON.stringify(summary, null, 2),
    );
    console.log('PaServe development seed completed.', summary);
    for (const shop of plan.shops) {
      console.log(
        `\n${shop.shop.name} (${shop.shop.slug}) — password: ${PASSWORD}`,
      );
      shop.users.forEach((user, n) =>
        console.log(`${shop.members[n]!.role}: ${user.email}`),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Driver exceptions can include connection details. Do not print credentials or SQL arguments.
  console.error(
    error instanceof Error
      ? error.message.replace(
          /postgres(?:ql)?:\/\/[^\s]+/g,
          '[redacted database URL]',
        )
      : 'Demo seed failed.',
  );
  process.exitCode = 1;
});
