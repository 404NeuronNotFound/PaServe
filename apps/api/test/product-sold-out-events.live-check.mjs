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
  slug = `fixture-${randomUUID()}`,
  otherShop = randomUUID(),
  otherSlug = `fixture-${randomUUID()}`;
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
    topic: `menu:availability:${shopId}:${slug}`,
    scope: { shopSlug: slug },
    stream: new Stream(),
  },
  {
    topic: `menu:availability:${otherShop}:${otherSlug}`,
    scope: { shopSlug: otherSlug },
    stream: new Stream(),
  },
];
try {
  await client.connect();
  await client.query(`CREATE TEMP TABLE shops(id text PRIMARY KEY,slug text,"isActive" boolean);
    CREATE TEMP TABLE categories(id text PRIMARY KEY,"shopId" text,"isVisible" boolean);
    CREATE TEMP TABLE products(id text PRIMARY KEY,"shopId" text,"categoryId" text,status text,"isArchived" boolean);`);
  const sql = await readFile(
    new URL(
      '../prisma/migrations/20261016000000_product_sold_out_events/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await client.query(
    sql
      .split('CREATE POLICY')[0]
      .replaceAll('public.products', 'pg_temp.products')
      .replaceAll('public.shops', 'pg_temp.shops')
      .replaceAll('public.categories', 'pg_temp.categories')
      .replaceAll(
        'public.broadcast_product_sold_out',
        'pg_temp.broadcast_product_sold_out',
      ),
  );
  for (const target of targets) {
    const connected = waitFor(target.stream, 'resync');
    await service.relay(
      target.topic,
      'product_sold_out',
      target.scope,
      async () => {},
      target.stream,
    );
    await connected;
  }
  await client.query(
    'INSERT INTO pg_temp.shops VALUES($1,$2,true),($3,$4,true)',
    [shopId, slug, otherShop, otherSlug],
  );
  await client.query(
    `INSERT INTO pg_temp.products VALUES('coffee',$1,NULL,'AVAILABLE',false)`,
    [shopId],
  );
  const sell = () =>
    client.query(
      `UPDATE pg_temp.products SET status='SOLD_OUT' WHERE id='coffee'`,
    );
  await client.query('BEGIN');
  await sell();
  await client.query('ROLLBACK');
  const received = waitFor(targets[0].stream, 'product_sold_out');
  await sell();
  assert.equal(
    await received,
    `event: product_sold_out\ndata: ${JSON.stringify({ shopSlug: slug })}\n\n`,
  );
  await sell();
  assert.equal(
    targets[0].stream.events.filter((f) =>
      f.startsWith('event: product_sold_out'),
    ).length,
    1,
  );
  assert.equal(
    targets[1].stream.events.filter((f) =>
      f.startsWith('event: product_sold_out'),
    ).length,
    0,
  );
  console.log(
    'Passed: exact sold-out trigger -> private Supabase Broadcast -> public menu SSE; other shop excluded, retry and rollback suppressed. Business tables and migration history unchanged.',
  );
} finally {
  for (const { stream } of targets) stream.emit('close');
  await service.onModuleDestroy();
  await client.end();
}
