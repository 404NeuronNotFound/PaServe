import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaService } from '../dist/database/prisma.service.js';

const prisma = new PrismaService();
try {
  const [version] =
    await prisma.$queryRaw`SELECT current_setting('server_version_num')::int AS version`;
  assert.ok(
    version.version >= 150000,
    'Tenant relation migration requires PostgreSQL 15 or later',
  );
  const [audit] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS products,
      COUNT(*) FILTER (WHERE p."categoryId" IS NOT NULL AND (c.id IS NULL OR c."shopId" <> p."shopId"))::int AS invalid_links
    FROM public.products p LEFT JOIN public.categories c ON c.id = p."categoryId"`;
  assert.equal(
    audit.invalid_links,
    0,
    'Existing product/category links cross shop boundaries; review before migration',
  );
  console.log(
    `Tenant preflight passed: PostgreSQL ${version.version}, ${audit.products} products, no invalid category/shop links.`,
  );
} finally {
  await prisma.$disconnect();
}
