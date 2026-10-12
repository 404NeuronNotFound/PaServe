import { ConfigService } from '@nestjs/config';
import {
  OrderTokenService,
  ORDER_TOKEN_SECONDS,
} from './order-token.service.js';
import { TableContextService } from '../tables/table-context.service.js';

const config = new ConfigService({
  JWT_ACCESS_SECRET: 'test-only-order-secret-at-least-32-characters',
});
describe('order receipt tokens', () => {
  const service = new OrderTokenService(config);
  const order = () => ({
    id: 'order-a',
    shopId: 'shop-a',
    ...service.metadata(),
    qrTokenRevokedAt: null,
  });
  afterEach(() => vi.restoreAllMocks());
  it('issues stable verifiable tokens from saved metadata with unique per-order nonces', () => {
    const first = order();
    const token = service.issue(first);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(service.issue(first)).toBe(token);
    expect(() => service.verify(token, first)).not.toThrow();
    expect(order().qrTokenNonce).not.toBe(first.qrTokenNonce);
    expect(first.qrTokenNonce).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.qrTokenExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      ORDER_TOKEN_SECONDS * 1000,
    );
  });
  it.each(['id', 'shopId', 'qrTokenNonce'] as const)(
    'rejects another persisted %s binding',
    (field) => {
      const first = order();
      expect(() =>
        service.verify(service.issue(first), { ...first, [field]: 'other' }),
      ).toThrow();
    },
  );
  it('rejects payload/signature tampering and a different signing secret', () => {
    const first = order();
    const token = service.issue(first);
    expect(() => service.verify(`${token}x`, first)).toThrow();
    expect(() => service.verify(`x${token.slice(1)}`, first)).toThrow();
    const other = new OrderTokenService(
      new ConfigService({
        JWT_ACCESS_SECRET: 'another-test-secret-at-least-32-characters',
      }),
    );
    expect(() => other.verify(token, first)).toThrow();
  });
  it('rejects table credentials, expired and revoked order tokens without extending replay expiry', () => {
    const first = order();
    const token = service.issue(first);
    expect(() =>
      service.verify(
        new TableContextService(config).issue('cafe', 'T12'),
        first,
      ),
    ).toThrow();
    expect(() =>
      service.verify(token, { ...first, qrTokenRevokedAt: new Date() }),
    ).toThrow();
    vi.spyOn(Date, 'now').mockReturnValue(first.qrTokenExpiresAt.getTime());
    expect(service.issue(first)).toBe(token);
    expect(() => service.verify(token, first)).toThrow();
  });
  it('rejects oversized or malformed credentials', () => {
    const first = order();
    for (const token of ['', 'invalid', 'ORD-000001', 'x'.repeat(1025)])
      expect(() => service.verify(token, first)).toThrow();
  });
  it('requires a configured signing secret', () => {
    expect(
      () =>
        new OrderTokenService(
          new ConfigService({ JWT_ACCESS_SECRET: 'short' }),
        ),
    ).toThrow();
  });
});
