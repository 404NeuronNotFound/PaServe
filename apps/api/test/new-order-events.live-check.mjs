import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import { NewOrderEventsService } from '../dist/modules/orders/new-order-events.service.js';

// Only session-local rows/functions are committed. No business tables or
// migration history are changed. Test broadcasts use a fresh random shop topic.
const shopId = randomUUID();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
class Stream extends EventEmitter {
  destroyed = false;
  headersSent = false;
  events = [];
  setHeader() {}
  flushHeaders() {
    this.headersSent = true;
  }
  write(frame) {
    this.events.push(frame);
    this.emit('frame', frame);
    return true;
  }
  end() {}
}
function waitFor(stream, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stream.off('frame', receive);
      reject(new Error(`No ${event} received within 20 seconds`));
    }, 20_000);
    function receive(frame) {
      if (frame.startsWith(`event: ${event}\n`)) {
        clearTimeout(timer);
        stream.off('frame', receive);
        resolve(frame);
      }
    }
    stream.on('frame', receive);
  });
}
const service = new NewOrderEventsService(
  new ConfigService(process.env),
  { currentUser: async () => ({ id: randomUUID() }) },
  { requirePermission: async () => ({ role: 'OWNER' }) },
);
const stream = new Stream();
try {
  await client.connect();
  await client.query(`CREATE TEMP TABLE orders (
    id text PRIMARY KEY, "shopId" text, status text, "paymentStatus" text,
    "preparationStatus" text, "queuedAt" timestamptz
  )`);
  const migration = await readFile(
    new URL(
      '../prisma/migrations/20261015190000_new_order_broadcast/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await client.query(
    migration
      .split('-- Deliberately')[0]
      .replaceAll(
        'public.broadcast_new_order_workflow',
        'pg_temp.broadcast_new_order_workflow',
      )
      .replaceAll('ON public.orders', 'ON pg_temp.orders'),
  );
  const connected = waitFor(stream, 'resync');
  await service.stream('fixture-session', shopId, 'kitchen', stream);
  await connected;
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO pg_temp.orders VALUES ('rollback', $1, 'CONFIRMED', 'PAID', 'QUEUED', now())`,
    [shopId],
  );
  await client.query('ROLLBACK');
  const arrival = waitFor(stream, 'new_order');
  await client.query(
    `INSERT INTO pg_temp.orders VALUES ('wrong-shop', $1, 'CONFIRMED', 'PAID', 'QUEUED', now())`,
    [randomUUID()],
  );
  await client.query(
    `INSERT INTO pg_temp.orders VALUES ('pending', $1, 'PENDING_CONFIRMATION', 'UNPAID', NULL, NULL)`,
    [shopId],
  );
  await client.query(
    `INSERT INTO pg_temp.orders VALUES ('eligible', $1, 'CONFIRMED', 'PAID', 'QUEUED', now())`,
    [shopId],
  );
  const received = await arrival;
  assert.equal(
    received,
    `event: new_order\ndata: ${JSON.stringify({ shopId, workflow: 'kitchen' })}\n\n`,
  );
  assert.equal(
    stream.events.filter((event) => event.startsWith('event: new_order'))
      .length,
    1,
  );
  console.log(
    'Passed: real database trigger -> private Supabase Broadcast -> backend subscription -> authorized SSE relay. Wrong-shop, pending, and rolled-back work did not reach the kitchen stream. Only session-local fixtures committed.',
  );
} finally {
  stream.emit('close');
  await service.onModuleDestroy();
  await client.end();
}
