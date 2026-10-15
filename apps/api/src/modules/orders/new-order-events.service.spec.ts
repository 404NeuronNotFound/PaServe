import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { ConfigService } from '@nestjs/config';
import type { AuthService } from '../auth/auth.service.js';
import type { ShopMembersService } from '../shop-members/shop-members.service.js';
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
      'order_confirmed',
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
  it('relays readiness only for the correct scope and rechecks access before each delivery', async () => {
    const stream = new Stream();
    const authorize = vi.fn().mockResolvedValue(undefined);
    await service.relay(
      'staff:preparation:shop-a',
      ['order_preparing', 'order_ready'],
      { shopId: 'shop-a' },
      authorize,
      stream as unknown as Response,
    );
    broadcast({
      event: 'order_ready',
      payload: { shopId: 'shop-b', orderId: 'other' },
    });
    await flush();
    expect(stream.write).not.toHaveBeenCalled();
    broadcast({
      event: 'order_ready',
      payload: {
        shopId: 'shop-a',
        orderId: 'order-a',
        preparationReadyBy: 'private-actor',
      },
    });
    await flush();
    expect(stream.write).toHaveBeenCalledExactlyOnceWith(
      'event: order_ready\ndata: {"shopId":"shop-a","orderId":"order-a"}\n\n',
    );
    authorize.mockRejectedValue(new Error('access removed'));
    broadcast({
      event: 'order_ready',
      payload: { shopId: 'shop-a', orderId: 'order-a' },
    });
    await flush();
    expect(stream.write).toHaveBeenCalledOnce();
    expect(stream.end).toHaveBeenCalledOnce();
  });

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
