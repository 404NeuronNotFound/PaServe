export const ORDER_STATUS_EVENTS = [
  'order_confirmed',
  'order_preparing',
  'order_ready',
  'order_completed',
] as const;
export type RealtimeEvent =
  | 'new_order'
  | (typeof ORDER_STATUS_EVENTS)[number]
  | 'product_sold_out'
  | 'product_available';

/** Internal channel contracts. Route parameters never select arbitrary topics. */
export function realtimeChannel(
  topic: string,
  events: RealtimeEvent | readonly RealtimeEvent[],
  scope: Record<string, string>,
) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('Invalid realtime channel configuration');
  }
  const names = typeof events === 'string' ? [events] : [...events];
  const keys = Object.keys(scope).sort().join(',');
  const identity = (value: unknown): value is string =>
    typeof value === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
  const validShop = identity(scope.shopId);
  let allowed: readonly RealtimeEvent[] = [];
  if (
    validShop &&
    keys === 'shopId,workflow' &&
    ['cashier', 'kitchen'].includes(scope.workflow) &&
    topic === `staff:new-order:${scope.shopId}:${scope.workflow}`
  ) {
    allowed = ['new_order'];
  } else if (
    validShop &&
    keys === 'shopId' &&
    topic === `staff:confirmed:${scope.shopId}`
  ) {
    allowed = ORDER_STATUS_EVENTS;
  } else if (
    validShop &&
    keys === 'shopId' &&
    topic === `staff:preparation:${scope.shopId}`
  ) {
    allowed = ['order_preparing', 'order_ready', 'order_completed'];
  } else if (
    validShop &&
    identity(scope.orderId) &&
    keys === 'orderId,shopId' &&
    topic === `customer:confirmed:${scope.shopId}:${scope.orderId}`
  ) {
    allowed = ORDER_STATUS_EVENTS;
  } else if (
    keys === 'shopSlug' &&
    typeof scope.shopSlug === 'string' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scope.shopSlug) &&
    scope.shopSlug.length <= 100
  ) {
    const parts = topic.split(':');
    if (
      parts.length === 4 &&
      parts[0] === 'menu' &&
      parts[1] === 'availability' &&
      identity(parts[2]) &&
      parts[3] === scope.shopSlug
    ) {
      allowed = ['product_sold_out', 'product_available'];
    }
  }
  if (
    !names.length ||
    !allowed.length ||
    names.some((name) => !allowed.includes(name))
  ) {
    throw new Error('Invalid realtime channel configuration');
  }
  return {
    topic,
    events: Object.freeze(names),
    scope: Object.freeze({ ...scope }),
  };
}
