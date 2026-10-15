import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import { NewOrderEventsService } from '../dist/modules/orders/new-order-events.service.js';

// Commits only temporary orders/functions and random-topic fixture messages.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const shopId = randomUUID(),
  orderId = randomUUID(),
  otherId = randomUUID();
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
    const timeout = setTimeout(() => {
      stream.off('frame', receive);
      reject(new Error(`No ${event} received within 20 seconds`));
    }, 20_000);
    function receive(frame) {
      if (frame.startsWith(`event: ${event}\n`)) {
        clearTimeout(timeout);
        stream.off('frame', receive);
        resolve(frame);
      }
    }
    stream.on('frame', receive);
  });
}
const service = new NewOrderEventsService(
  new ConfigService(process.env),
  {},
  {},
);
const targets = [
  {
    topic: `staff:preparation:${shopId}`,
    scope: { shopId },
    stream: new Stream(),
  },
  {
    topic: `staff:confirmed:${shopId}`,
    scope: { shopId },
    stream: new Stream(),
  },
  {
    topic: `customer:confirmed:${shopId}:${orderId}`,
    scope: { shopId, orderId },
    stream: new Stream(),
  },
  {
    topic: `customer:confirmed:${shopId}:${otherId}`,
    scope: { shopId, orderId: otherId },
    stream: new Stream(),
  },
];
try {
  await client.connect();
  await client.query(
    `CREATE TEMP TABLE orders(id text PRIMARY KEY,"shopId" text,status text,"paymentStatus" text,"preparationStatus" text,"queuedAt" timestamp(3),"preparationStartedAt" timestamp(3),"preparationStartedBy" text,"preparationReadyAt" timestamp(3),"preparationReadyBy" text,"completedAt" timestamp(3),"completedBy" text)`,
  );
  const sql = await readFile(
    new URL(
      '../prisma/migrations/20261015230000_order_completed_events/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await client.query(
    sql
      .replaceAll('public.orders', 'pg_temp.orders')
      .replaceAll(
        'public.broadcast_order_completed',
        'pg_temp.broadcast_order_completed',
      ),
  );
  await Promise.all(
    targets.map(async ({ topic, scope, stream }) => {
      const connected = waitFor(stream, 'resync');
      await service.relay(
        topic,
        ['order_completed'],
        scope,
        async () => {},
        stream,
      );
      await connected;
    }),
  );
  const create = (id, shop) =>
    client.query(
      `INSERT INTO pg_temp.orders VALUES($1,$2,'CONFIRMED','PAID','READY',now(),now()+interval '1 second','fixture-start',now()+interval '2 seconds','fixture-ready',NULL,NULL)`,
      [id, shop],
    );
  const complete = (id) =>
    client.query(
      `UPDATE pg_temp.orders SET "preparationStatus"='COMPLETED',"completedAt"="preparationReadyAt"+interval '1 second',"completedBy"='fixture-completed' WHERE id=$1`,
      [id],
    );
  await create(orderId, shopId);
  await client.query('BEGIN');
  await complete(orderId);
  await client.query('ROLLBACK');
  const foreign = randomUUID();
  await create(foreign, randomUUID());
  await complete(foreign);
  const arrivals = targets
    .slice(0, 3)
    .map(({ stream }) => waitFor(stream, 'order_completed'));
  await complete(orderId);
  for (const frame of await Promise.all(arrivals))
    assert.equal(
      frame,
      `event: order_completed\ndata: ${JSON.stringify({ shopId, orderId })}\n\n`,
    );
  for (const { stream } of targets.slice(0, 3))
    assert.equal(
      stream.events.filter((frame) =>
        frame.startsWith('event: order_completed'),
      ).length,
      1,
    );
  assert.equal(
    targets[3].stream.events.filter((frame) =>
      frame.startsWith('event: order_completed'),
    ).length,
    0,
  );
  console.log(
    'Passed: real completion trigger -> private Supabase Broadcast -> kitchen, cashier, and exact customer SSE. Other shop/order and rolled-back completion excluded. Public business data and migration history unchanged.',
  );
} finally {
  for (const { stream } of targets) stream.emit('close');
  await service.onModuleDestroy();
  await client.end();
}
