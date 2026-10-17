import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { ConfigService } from '@nestjs/config';
import type { AuthService } from '../auth/auth.service.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import type { ShopMembersRepository } from '../shop-members/shop-members.repository.js';
import { NewOrderEventsService } from './new-order-events.service.js';

const fake = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: fake.create }));

class Stream extends EventEmitter {
  destroyed = false;
  headersSent = false;
  write = vi.fn(() => true);
  end = vi.fn();
  setHeader = vi.fn();
  flushHeaders = vi.fn(() => {
    this.headersSent = true;
  });
}

describe('New order staff subscriptions', () => {
  const auth = { currentUser: vi.fn() };
  const members = { requirePermission: vi.fn() };
  const config = { getOrThrow: vi.fn((key: string) => key) };
  let service: NewOrderEventsService;
  let broadcast: (message: { payload: unknown; event?: string }) => void;
  let status: (value: string) => void;
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  const client = {
    channel: vi.fn(),
    removeChannel: vi.fn(),
    removeAllChannels: vi.fn(),
    realtime: { disconnect: vi.fn() },
  };
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const open = async (workflow: 'cashier' | 'kitchen' = 'kitchen') => {
    const stream = new Stream();
    await service.stream(
      'bearer-secret',
      'shop-a',
      workflow,
      stream as unknown as Response,
    );
    return stream;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    auth.currentUser.mockResolvedValue({ id: 'actor-a' });
    members.requirePermission.mockResolvedValue({ role: 'KITCHEN' });
    client.channel.mockReturnValue(channel);
    channel.on.mockImplementation((_type, _filter, callback) => {
      broadcast = (message) => callback({ event: 'new_order', ...message });
      return channel;
    });
    channel.subscribe.mockImplementation((callback) => {
      status = callback;
      return channel;
    });
    fake.create.mockReturnValue(client);
    service = new NewOrderEventsService(
      config as unknown as ConfigService,
      auth as unknown as AuthService,
      members as unknown as ShopMembersService,
    );
  });
  afterEach(async () => {
    await service.onModuleDestroy();
    vi.useRealTimers();
  });

  it('uses private backend channels and relays only matching shop/workflow invalidations', async () => {
    const stream = await open();
    expect(client.channel).toHaveBeenCalledWith(
      'staff:new-order:shop-a:kitchen',
      { config: { private: true } },
    );
    broadcast({ payload: { shopId: 'shop-b', workflow: 'kitchen' } });
    broadcast({ payload: { shopId: 'shop-a', workflow: 'cashier' } });
    await flush();
    expect(stream.write).not.toHaveBeenCalled();
    broadcast({
      payload: {
        shopId: 'shop-a',
        workflow: 'kitchen',
        qrToken: 'must-not-relay',
      },
    });
    await flush();
    expect(stream.write).toHaveBeenCalledWith(
      'event: new_order\ndata: {"shopId":"shop-a","workflow":"kitchen"}\n\n',
    );
    expect(members.requirePermission).toHaveBeenLastCalledWith(
      'actor-a',
      'shop-a',
      'shop.preparation.queue.read',
    );
    stream.emit('close');
  });

  it('checks cashier read permission before subscribing', async () => {
    members.requirePermission.mockRejectedValue(new Error('forbidden'));
    await expect(open('cashier')).rejects.toThrow('forbidden');
    expect(members.requirePermission).toHaveBeenCalledWith(
      'actor-a',
      'shop-a',
      'shop.orders.read',
    );
    expect(client.channel).not.toHaveBeenCalled();
  });
  it('isolates preparation events by scope and event type on a shared channel', async () => {
    const preparing = new Stream(),
      confirmation = new Stream();
    const authorize = vi.fn().mockResolvedValue(undefined);
    await service.relay(
      'staff:preparation:shop-a',
      'order_preparing',
      { shopId: 'shop-a' },
      authorize,
      preparing as unknown as Response,
    );
    await service.relay(
      'staff:preparation:shop-a',
      'order_ready',
      { shopId: 'shop-a' },
      authorize,
      confirmation as unknown as Response,
    );
    await flush();
    preparing.write.mockClear();
    confirmation.write.mockClear();
    broadcast({
      event: 'order_preparing',
      payload: { shopId: 'shop-b', orderId: 'other-order' },
    });
    await flush();
    expect(preparing.write).not.toHaveBeenCalled();
    broadcast({
      event: 'order_preparing',
      payload: {
        shopId: 'shop-a',
        orderId: 'order-a',
        preparationStartedBy: 'private',
      },
    });
    await flush();
    expect(preparing.write).toHaveBeenCalledExactlyOnceWith(
      'event: order_preparing\ndata: {"shopId":"shop-a","orderId":"order-a"}\n\n',
    );
    expect(confirmation.write).not.toHaveBeenCalled();
    preparing.emit('close');
    confirmation.emit('close');
  });

  it('rechecks the session and live membership before delivery and closes revoked access', async () => {
    const stream = await open();
    members.requirePermission.mockRejectedValue(new Error('removed'));
    broadcast({ payload: { shopId: 'shop-a', workflow: 'kitchen' } });
    await flush();
    expect(auth.currentUser).toHaveBeenCalledTimes(2);
    expect(stream.write).not.toHaveBeenCalled();
    expect(stream.end).toHaveBeenCalledOnce();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it.each(['event', 'heartbeat'])(
    'closes a suspended membership stream on the next %s using live membership checks',
    async (trigger) => {
      const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
      const record = {
        id: 'm',
        shopId,
        role: 'KITCHEN',
        disabledAt: null as Date | null,
        user: { isActive: true },
        shop: { id: shopId, name: 'Cafe', slug: 'cafe', isActive: true },
      };
      const repository = { findMembership: vi.fn(async () => record) };
      const liveMembers = new ShopMembersService(
        repository as unknown as ShopMembersRepository,
      );
      const stream = new Stream();
      await service.relay(
        `staff:preparation:${shopId}`,
        'order_ready',
        { shopId },
        () =>
          liveMembers.requirePermission(
            'actor-a',
            shopId,
            'shop.preparation.queue.read',
          ),
        stream as unknown as Response,
      );
      await flush();
      stream.write.mockClear();
      record.disabledAt = new Date();
      if (trigger === 'event') {
        broadcast({
          event: 'order_ready',
          payload: { shopId, orderId: 'order-a' },
        });
        await flush();
      } else await vi.advanceTimersByTimeAsync(15_000);
      expect(stream.write).not.toHaveBeenCalled();
      expect(stream.end).toHaveBeenCalledOnce();
    },
  );
  it.each(['order_ready', 'order_completed'])(
    'relays %s only for the correct scope and rechecks access before delivery',
    async (event) => {
      const stream = new Stream();
      const authorize = vi.fn().mockResolvedValue(undefined);
      await service.relay(
        'staff:preparation:shop-a',
        ['order_preparing', 'order_ready', 'order_completed'],
        { shopId: 'shop-a' },
        authorize,
        stream as unknown as Response,
      );
      broadcast({
        event,
        payload: { shopId: 'shop-b', orderId: 'other' },
      });
      await flush();
      expect(stream.write).not.toHaveBeenCalled();
      broadcast({
        event,
        payload: {
          shopId: 'shop-a',
          orderId: 'order-a',
          preparationReadyBy: 'private-actor',
        },
      });
      await flush();
      expect(stream.write).toHaveBeenCalledExactlyOnceWith(
        `event: ${event}\ndata: {"shopId":"shop-a","orderId":"order-a"}\n\n`,
      );
      authorize.mockRejectedValue(new Error('access removed'));
      broadcast({
        event,
        payload: { shopId: 'shop-a', orderId: 'order-a' },
      });
      await flush();
      expect(stream.write).toHaveBeenCalledOnce();
      expect(stream.end).toHaveBeenCalledOnce();
    },
  );

  it.each(['product_sold_out', 'product_available'] as const)(
    'relays %s only to its public menu and closes when the shop is no longer public',
    async (event) => {
      const stream = new Stream();
      const authorize = vi.fn().mockResolvedValue(undefined);
      await service.relay(
        'menu:availability:shop-a:cafe',
        event,
        { shopSlug: 'cafe' },
        authorize,
        stream as unknown as Response,
      );
      broadcast({ event, payload: { shopSlug: 'other' } });
      await flush();
      expect(stream.write).not.toHaveBeenCalled();
      broadcast({
        event: event,
        payload: { shopSlug: 'cafe', productId: 'private', actorId: 'private' },
      });
      await flush();
      expect(stream.write).toHaveBeenCalledExactlyOnceWith(
        `event: ${event}\ndata: {"shopSlug":"cafe"}\n\n`,
      );
      authorize.mockRejectedValue(new Error('shop disabled'));
      broadcast({ event, payload: { shopSlug: 'cafe' } });
      await flush();
      expect(stream.write).toHaveBeenCalledOnce();
      expect(stream.end).toHaveBeenCalledOnce();
    },
  );
  it('resynchronizes on upstream reconnect and shares/cleans up local subscribers', async () => {
    const first = await open();
    status('SUBSCRIBED');
    await flush();
    expect(first.write.mock.lastCall?.[0]).toContain('event: resync');
    const second = await open();
    await flush();
    expect(second.write.mock.lastCall?.[0]).toContain('event: resync');
    expect(client.channel).toHaveBeenCalledOnce();
    first.emit('close');
    expect(client.removeChannel).not.toHaveBeenCalled();
    status('CHANNEL_ERROR');
    await flush();
    expect(second.write.mock.lastCall?.[0]).toContain('event: unavailable');
    second.emit('close');
    expect(client.removeChannel).toHaveBeenCalledOnce();
  });

  it('does not claim live delivery for an additional subscriber during an upstream outage', async () => {
    const first = await open();
    status('CHANNEL_ERROR');
    const second = await open();
    await flush();
    expect(second.write.mock.lastCall?.[0]).toContain('event: unavailable');
    first.emit('close');
    second.emit('close');
  });

  it('waits for a leaving channel before subscribing again to the same topic', async () => {
    const first = await open();
    let finish!: () => void;
    client.removeChannel.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    first.emit('close');
    const reopening = open();
    await flush();
    expect(client.channel).toHaveBeenCalledOnce();
    finish();
    const second = await reopening;
    expect(client.channel).toHaveBeenCalledTimes(2);
    second.emit('close');
  });

  it('rejects a mismatched tenant channel before authorization or subscription', async () => {
    const authorize = vi.fn();
    await expect(
      service.relay(
        'staff:confirmed:shop-b',
        'order_ready',
        { shopId: 'shop-a' },
        authorize,
        new Stream() as unknown as Response,
      ),
    ).rejects.toThrow('Invalid realtime channel configuration');
    expect(authorize).not.toHaveBeenCalled();
    expect(client.channel).not.toHaveBeenCalled();
  });

  it('recovers after failed subscription setup instead of reusing a poisoned channel', async () => {
    channel.subscribe.mockImplementationOnce(() => {
      throw new Error('upstream unavailable');
    });
    await expect(open()).rejects.toMatchObject({
      response: { code: 'REALTIME_UNAVAILABLE' },
      status: 503,
    });
    expect(client.removeChannel).toHaveBeenCalledOnce();
    const stream = await open();
    status('SUBSCRIBED');
    await flush();
    expect(client.channel).toHaveBeenCalledTimes(2);
    expect(stream.write.mock.lastCall?.[0]).toContain('event: resync');
  });

  it('opens SSE headers before synchronous subscribe callbacks or shared-channel resync writes', async () => {
    channel.subscribe.mockImplementationOnce((callback) => {
      status = callback;
      callback('SUBSCRIBED');
      return channel;
    });
    const first = await open();
    const second = await open();
    await flush();
    for (const stream of [first, second]) {
      expect(stream.write.mock.calls.length).toBeGreaterThan(0);
      expect(stream.flushHeaders.mock.invocationCallOrder[0]).toBeLessThan(
        stream.write.mock.invocationCallOrder[0],
      );
      expect(stream.write.mock.lastCall?.[0]).toContain('event: resync');
    }
  });

  it('revokes one shared-channel recipient without delivering to it or disconnecting an authorized peer', async () => {
    const first = new Stream(),
      second = new Stream();
    const authorizeFirst = vi.fn().mockResolvedValue(undefined),
      authorizeSecond = vi.fn().mockResolvedValue(undefined);
    for (const [stream, authorize] of [
      [first, authorizeFirst],
      [second, authorizeSecond],
    ] as const) {
      await service.relay(
        'staff:confirmed:shop-a',
        'order_completed',
        { shopId: 'shop-a' },
        authorize,
        stream as unknown as Response,
      );
    }
    await flush();
    first.write.mockClear();
    second.write.mockClear();
    authorizeFirst.mockRejectedValue(new Error('membership removed'));
    broadcast({
      event: 'order_completed',
      payload: { shopId: 'shop-a', orderId: 'order-a' },
    });
    await flush();
    expect(first.write).not.toHaveBeenCalled();
    expect(first.end).toHaveBeenCalledOnce();
    expect(second.write).toHaveBeenCalledExactlyOnceWith(
      'event: order_completed\ndata: {"shopId":"shop-a","orderId":"order-a"}\n\n',
    );
    expect(second.end).not.toHaveBeenCalled();
    expect(client.removeChannel).not.toHaveBeenCalled();
  });

  it('still closes an SSE connection if upstream channel cleanup throws', async () => {
    const stream = await open();
    client.removeChannel.mockImplementationOnce(() => {
      throw new Error('socket already closed');
    });
    expect(() => stream.emit('close')).not.toThrow();
    expect(stream.end).toHaveBeenCalledOnce();
    const recovered = await open();
    expect(client.channel).toHaveBeenCalledTimes(2);
    recovered.emit('close');
  });

  it('ends active streams on module shutdown', async () => {
    const stream = await open();
    await service.onModuleDestroy();
    expect(stream.end).toHaveBeenCalledOnce();
  });

  it('closes expired sessions on heartbeat and bounds slow/disconnected connections', async () => {
    const stream = await open();
    auth.currentUser.mockRejectedValueOnce(new Error('expired'));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(stream.end).toHaveBeenCalledOnce();
    const slow = await open();
    slow.write.mockReturnValue(false);
    status('SUBSCRIBED');
    await flush();
    expect(slow.end).toHaveBeenCalledOnce();
    const idle = await open();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(idle.end).toHaveBeenCalledOnce();
  });
});
