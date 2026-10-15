import { realtimeChannel, type RealtimeEvent } from './realtime-channel.js';

describe('Realtime channel contracts', () => {
  it.each([
    [
      'staff:new-order:shop-a:cashier',
      'new_order',
      { shopId: 'shop-a', workflow: 'cashier' },
    ],
    [
      'staff:new-order:shop-a:kitchen',
      'new_order',
      { shopId: 'shop-a', workflow: 'kitchen' },
    ],
    ['staff:confirmed:shop-a', 'order_confirmed', { shopId: 'shop-a' }],
    ['staff:preparation:shop-a', 'order_completed', { shopId: 'shop-a' }],
    [
      'customer:confirmed:shop-a:order-a',
      'order_ready',
      { shopId: 'shop-a', orderId: 'order-a' },
    ],
    [
      'menu:availability:shop-a:cafe',
      'product_available',
      { shopSlug: 'cafe' },
    ],
  ] as const)(
    'accepts the explicitly scoped channel %s',
    (topic, event, scope) => {
      expect(realtimeChannel(topic, event, scope).topic).toBe(topic);
    },
  );
  it.each([
    ['staff:confirmed:shop-b', ['order_confirmed'], { shopId: 'shop-a' }],
    [
      'customer:confirmed:shop-a:order-b',
      ['order_ready'],
      { shopId: 'shop-a', orderId: 'order-a' },
    ],
    [
      'customer:confirmed:shop-a:order-a',
      ['order_ready'],
      { shopId: 'shop-a' },
    ],
    [
      'staff:new-order:shop-a:kitchen',
      ['new_order'],
      { shopId: 'shop-a', workflow: 'cashier' },
    ],
    ['staff:confirmed:shop-a', ['product_available'], { shopId: 'shop-a' }],
    [
      'menu:availability:shop-a:cafe',
      ['order_confirmed'],
      { shopSlug: 'cafe' },
    ],
    [
      'menu:availability:shop-a:cafe',
      ['product_available'],
      { shopSlug: 'other' },
    ],
    ['staff:preparation:shop-a', ['order_confirmed'], { shopId: 'shop-a' }],
    [
      'staff:confirmed:shop-a',
      ['order_ready'],
      { shopId: 'shop-a', role: 'OWNER' },
    ],
    ['staff:confirmed:shop-a', [], { shopId: 'shop-a' }],
    ['staff:confirmed:*', ['order_ready'], { shopId: '*' }],
    ['staff:confirmed:shop:a', ['order_ready'], { shopId: 'shop:a' }],
    ['unknown:shop-a', ['order_ready'], { shopId: 'shop-a' }],
    ['staff:confirmed:shop-a', ['order_ready'], {}],
  ])('rejects unsafe/mismatched topic %s', (topic, events, scope) => {
    expect(() =>
      realtimeChannel(
        topic as string,
        events as RealtimeEvent[],
        scope as Record<string, string>,
      ),
    ).toThrow('Invalid realtime channel configuration');
  });
  it('snapshots the scope and event allowlist so caller mutations cannot retarget a stream', () => {
    const scope = { shopId: 'shop-a' };
    const events: RealtimeEvent[] = ['order_ready'];
    const channel = realtimeChannel('staff:confirmed:shop-a', events, scope);
    scope.shopId = 'shop-b';
    events.push('product_available');
    expect(channel.scope).toEqual({ shopId: 'shop-a' });
    expect(channel.events).toEqual(['order_ready']);
    expect(Object.isFrozen(channel.scope)).toBe(true);
    expect(Object.isFrozen(channel.events)).toBe(true);
  });
});
