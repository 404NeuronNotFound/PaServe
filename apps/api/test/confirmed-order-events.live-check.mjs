import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import { NewOrderEventsService } from '../dist/modules/orders/new-order-events.service.js';

// Real Broadcast/SSE check. Only temporary orders/functions and random-topic
// fixture messages are committed. No public business data or policies change.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const shopId = randomUUID(),
  orderId = randomUUID(),
  otherOrder = randomUUID();
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
    topic: `customer:confirmed:${shopId}:${otherOrder}`,
    scope: { shopId, orderId: otherOrder },
    stream: new Stream(),
  },
];
try {
  await client.connect();
  await client.query(
    `CREATE TEMP TABLE orders (id text PRIMARY KEY,"shopId" text,status text,"paymentStatus" text,"decidedAt" timestamp(3),"paidAt" timestamp(3))`,
  );
  const migration = await readFile(
    new URL(
      '../prisma/migrations/20261015200000_order_confirmed_events/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await client.query(
    migration
      .slice(
        migration.indexOf('CREATE FUNCTION'),
        migration.indexOf('CREATE POLICY'),
      )
      .replaceAll('public.orders', 'pg_temp.orders')
      .replaceAll(
        'public.broadcast_order_confirmed',
        'pg_temp.broadcast_order_confirmed',
      ),
  );
  await Promise.all(
    targets.map(async ({ topic, scope, stream }) => {
      const ready = waitFor(stream, 'resync');
      await service.relay(
        topic,
        'order_confirmed',
        scope,
        async () => {},
        stream,
      );
      await ready;
    }),
  );
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO pg_temp.orders VALUES($1,$2,'CONFIRMED','PAID',now(),now())`,
    [orderId, shopId],
  );
  await client.query('ROLLBACK');
  await client.query(
    `INSERT INTO pg_temp.orders VALUES($1,$2,'CONFIRMED','PAID',now(),now())`,
    [randomUUID(), randomUUID()],
  );
  const staff = waitFor(targets[0].stream, 'order_confirmed');
  const customer = waitFor(targets[1].stream, 'order_confirmed');
  await client.query(
    `INSERT INTO pg_temp.orders VALUES($1,$2,'PENDING_CONFIRMATION','UNPAID',NULL,NULL)`,
    [orderId, shopId],
  );
  await client.query(
    `UPDATE pg_temp.orders SET status='CONFIRMED',"paymentStatus"='PAID',"decidedAt"=now(),"paidAt"=now() WHERE id=$1`,
    [orderId],
  );
  const frames = await Promise.all([staff, customer]);
  for (const frame of frames)
    assert.equal(
      frame,
      `event: order_confirmed\ndata: ${JSON.stringify({ shopId, orderId })}\n\n`,
    );
  assert.equal(
    targets[0].stream.events.filter((frame) =>
      frame.startsWith('event: order_confirmed'),
    ).length,
    1,
  );
  assert.equal(
    targets[1].stream.events.filter((frame) =>
      frame.startsWith('event: order_confirmed'),
    ).length,
    1,
  );
  assert.equal(
    targets[2].stream.events.filter((frame) =>
      frame.startsWith('event: order_confirmed'),
    ).length,
    0,
  );
  console.log(
    'Passed: real confirmation trigger -> private Supabase Broadcast -> staff and exact-customer SSE. Other shop/order and rolled-back confirmation excluded. Public business data and migration history unchanged.',
  );
} finally {
  for (const { stream } of targets) stream.emit('close');
  await service.onModuleDestroy();
  await client.end();
}
