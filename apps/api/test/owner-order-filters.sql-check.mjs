import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { ActiveOrdersService } from '../dist/modules/orders/active-orders.service.js';
import { CompletedOrdersService } from '../dist/modules/orders/completed-orders.service.js';
import { CancelledOrdersService } from '../dist/modules/orders/cancelled-orders.service.js';

// Compile the installed Prisma client's real SQL. No DB connection is allowed.
const queries = [];
const pool = new pg.Pool({
  connectionString: 'postgres://unused:unused@127.0.0.1:1/unused',
});
pool.query = async (query) => {
  queries.push(query);
  return { rows: [], fields: [], rowCount: 0, command: 'SELECT' };
};
pool.connect = async () => {
  throw new Error('Database connections are disabled for SQL inspection.');
};
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const actorId = randomUUID(),
  shopId = randomUUID();
const members = { requireOwner: async () => {} };
try {
  for (const Service of [
    ActiveOrdersService,
    CompletedOrdersService,
    CancelledOrdersService,
  ]) {
    const service = new Service(prisma, members);
    const page = await service.list(actorId, shopId, undefined, 'ORD%_', {
      table: 'Patio %_\\',
      from: '2026-10-16',
      to: '2026-10-16',
    });
    assert.deepEqual(page, { orders: [], nextCursor: null });
    const { text, values } = queries.at(-1);
    assert.match(text, /ILIKE/);
    assert.match(text, /LIMIT/);
    assert.ok(
      values.includes('Patio \\%\\_\\\\'),
      'Exact table label must escape wildcard and backslash characters',
    );
    assert.ok(
      values.includes('ORD\\%\\_'),
      'Substring search must escape wildcard characters',
    );
    assert.ok(
      values.includes(actorId) && values.includes(shopId),
      'Actor and shop remain scoped in compiled SQL',
    );
    assert.ok(
      values.some((value) => String(value) === '26'),
      'Query fetches only one bounded page plus lookahead',
    );
    assert.ok(
      values.includes('2026-10-15 16:00:00'),
      'Manila start boundary is bound as UTC',
    );
    assert.ok(
      values.includes('2026-10-16 16:00:00'),
      'Inclusive Manila end day becomes next midnight UTC',
    );
  }
  assert.equal(queries.length, 3);
  console.log(
    'Passed: all three owner lists compile scoped, bounded SQL with literal table/search matching and Manila date bounds; no database was contacted.',
  );
} finally {
  await prisma.$disconnect();
}
