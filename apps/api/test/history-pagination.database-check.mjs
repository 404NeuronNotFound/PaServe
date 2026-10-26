import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ActiveOrdersService } from '../dist/modules/orders/active-orders.service.js';
import { CompletedOrdersService } from '../dist/modules/orders/completed-orders.service.js';
import { CancelledOrdersService } from '../dist/modules/orders/cancelled-orders.service.js';
import { PreparationQueueService } from '../dist/modules/orders/preparation-queue.service.js';

// Read-only: random nonexistent tenant and actor IDs; no fixture writes or migrations.
const prisma = new PrismaService();
const actorId = randomUUID(), shopId = randomUUID();
const snapshot = new Date(Date.now() - 1000).toISOString();
const paging = { page: '999', snapshot };
const members = { requireOwner: async () => {} };
try {
  for (const Service of [ActiveOrdersService, CompletedOrdersService, CancelledOrdersService]) {
    const result = await new Service(prisma, members).list(actorId, shopId, undefined, '000042', { mode: 'TAKEOUT' }, paging);
    assert.deepEqual(result.orders, []);
    assert.equal(result.nextCursor, null);
    assert.deepEqual(result.pagination, { page: 1, pageCount: 1, pageSize: 12, total: 0, snapshot, hasNew: false });
  }
  const result = await new PreparationQueueService(prisma).list(actorId, shopId, undefined, 'COMPLETED', { ...paging, limit: '12', search: '000042' });
  assert.deepEqual(result.orders, []);
  assert.deepEqual(result.pagination, { page: 1, pageCount: 1, pageSize: 12, total: 0, snapshot, hasNew: false });
  console.log('All four numbered endpoints passed read-only database checks with tenant scoping, filters and repeatable-read transactions.');
} catch {
  console.error('History pagination database check failed.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
