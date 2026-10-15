import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import { NewOrderEventsService } from '../dist/modules/orders/new-order-events.service.js';

// Publishes only random-topic fixture messages; no business tables are written.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const shopId = randomUUID(),
  otherShop = randomUUID(),
  orderId = randomUUID(),
  otherOrder = randomUUID();
const slug = `fixture-${randomUUID()}`;
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
function waitFor(stream, event, label = 'fixture') {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      stream.off('frame', receive);
      reject(
        new Error(
          `No ${event} received within 20 seconds (${label}; frames: ${stream.events.map((frame) => frame.split('\n')[0]).join(',')})`,
        ),
      );
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
    topic: `staff:new-order:${shopId}:cashier`,
    scope: { shopId, workflow: 'cashier' },
    events: ['new_order'],
  },
  {
    topic: `staff:new-order:${shopId}:kitchen`,
    scope: { shopId, workflow: 'kitchen' },
    events: ['new_order'],
  },
  {
    topic: `staff:confirmed:${shopId}`,
    scope: { shopId },
    events: [
      'order_confirmed',
      'order_preparing',
      'order_ready',
      'order_completed',
    ],
  },
  {
    topic: `staff:preparation:${shopId}`,
    scope: { shopId },
    events: ['order_preparing', 'order_ready', 'order_completed'],
  },
  {
    topic: `customer:confirmed:${shopId}:${orderId}`,
    scope: { shopId, orderId },
    events: [
      'order_confirmed',
      'order_preparing',
      'order_ready',
      'order_completed',
    ],
  },
  {
    topic: `menu:availability:${shopId}:${slug}`,
    scope: { shopSlug: slug },
    events: ['product_sold_out', 'product_available'],
  },
  {
    topic: `staff:confirmed:${otherShop}`,
    scope: { shopId: otherShop },
    events: ['order_completed'],
    foreign: true,
  },
  {
    topic: `customer:confirmed:${shopId}:${otherOrder}`,
    scope: { shopId, orderId: otherOrder },
    events: ['order_completed'],
    foreign: true,
  },
  {
    topic: `staff:new-order:${otherShop}:cashier`,
    scope: { shopId: otherShop, workflow: 'cashier' },
    events: ['new_order'],
    foreign: true,
  },
  {
    topic: `staff:new-order:${otherShop}:kitchen`,
    scope: { shopId: otherShop, workflow: 'kitchen' },
    events: ['new_order'],
    foreign: true,
  },
  {
    topic: `staff:preparation:${otherShop}`,
    scope: { shopId: otherShop },
    events: ['order_preparing', 'order_ready', 'order_completed'],
    foreign: true,
  },
  {
    topic: `customer:confirmed:${otherShop}:${orderId}`,
    scope: { shopId: otherShop, orderId },
    events: [
      'order_confirmed',
      'order_preparing',
      'order_ready',
      'order_completed',
    ],
    foreign: true,
  },
  {
    topic: `menu:availability:${otherShop}:other-menu`,
    scope: { shopSlug: 'other-menu' },
    events: ['product_sold_out', 'product_available'],
    foreign: true,
  },
].map((target) => ({ ...target, stream: new Stream() }));
// A second local recipient shares the upstream channel but has independent access.
let revoked = false;
const revokedStream = new Stream();
try {
  await client.connect();
  await Promise.all(
    targets.map(async (target) => {
      const connected = waitFor(
        target.stream,
        'resync',
        `initial ${target.topic}`,
      );
      await service.relay(
        target.topic,
        target.events,
        target.scope,
        async () => {},
        target.stream,
      );
      await connected;
    }),
  );
  const connected = waitFor(revokedStream, 'resync', 'shared recipient');
  await service.relay(
    targets[2].topic,
    targets[2].events,
    targets[2].scope,
    async () => {
      if (revoked) throw new Error('access revoked');
    },
    revokedStream,
  );
  await connected;
  revoked = true;
  const publish = (target, event) =>
    client.query('SELECT realtime.send($1::jsonb,$2,$3,true)', [
      JSON.stringify({
        ...target.scope,
        ...(!event.startsWith('product_') && event !== 'new_order'
          ? { orderId }
          : {}),
        privateActor: 'must-not-relay',
      }),
      event,
      target.topic,
    ]);
  await client.query('BEGIN');
  await publish(targets[2], 'order_completed');
  await client.query('ROLLBACK');
  for (const target of targets.filter((target) => !target.foreign)) {
    for (const event of target.events) {
      const receive = waitFor(target.stream, event);
      await publish(target, event);
      const safe = {
        ...target.scope,
        ...(!event.startsWith('product_') && event !== 'new_order'
          ? { orderId }
          : {}),
      };
      assert.equal(
        await receive,
        `event: ${event}\ndata: ${JSON.stringify(safe)}\n\n`,
      );
    }
    const deliveries = target.stream.events.filter((frame) =>
      target.events.some((event) => frame.startsWith(`event: ${event}\n`)),
    );
    assert.equal(deliveries.length, target.events.length);
  }
  // Exercise an actual leave/rejoin of the shared private channel and require
  // authoritative resync before subsequent delivery, with no duplicate event.
  targets[2].stream.emit('close');
  const reopened = new Stream();
  const resync = waitFor(reopened, 'resync', 'leave/rejoin');
  await service.relay(
    targets[2].topic,
    targets[2].events,
    targets[2].scope,
    async () => {},
    reopened,
  );
  await resync;
  targets[2].stream = reopened;
  const next = waitFor(reopened, 'order_completed');
  await publish(targets[2], 'order_completed');
  assert.equal(
    await next,
    `event: order_completed\ndata: ${JSON.stringify({ shopId, orderId })}\n\n`,
  );
  assert.equal(
    reopened.events.filter((frame) =>
      frame.startsWith('event: order_completed\n'),
    ).length,
    1,
  );
  for (const target of targets.filter((target) => target.foreign)) {
    assert.equal(
      target.stream.events.filter((frame) =>
        /^event: (?:new_order|order_[a-z_]+|product_[a-z_]+)\n/.test(frame),
      ).length,
      0,
    );
  }
  assert.equal(
    revokedStream.events.filter((frame) =>
      /^event: (?:new_order|order_[a-z_]+|product_[a-z_]+)\n/.test(frame),
    ).length,
    0,
  );
  assert.equal(
    service.streams.size,
    targets.length,
    'Revoked recipient disconnected without closing its authorized peer',
  );
  console.log(
    'Passed: private live delivery across every application channel/event family, minimal payloads, other-shop/order exclusion, per-recipient revocation, shared subscription, live leave/rejoin resync, and rollback suppression. Business rows and migration history unchanged.',
  );
} finally {
  revokedStream.emit('close');
  for (const target of targets) target.stream.emit('close');
  await service.onModuleDestroy();
  await client.end();
}
