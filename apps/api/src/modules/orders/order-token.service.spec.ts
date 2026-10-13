import { ConfigService } from '@nestjs/config';
import {
  OrderTokenService,
  ORDER_TOKEN_SECONDS,
} from './order-token.service.js';
import { TableContextService } from '../tables/table-context.service.js';
import { createHmac } from 'node:crypto';

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
  it('rejects invalid persisted expiry and nonce metadata even when signed', () => {
    const invalidExpiry = {
      ...order(),
      qrTokenExpiresAt: new Date(Number.NaN),
    };
    expect(() =>
      service.verify(service.issue(invalidExpiry), invalidExpiry),
    ).toThrow();
    const invalidNonce = { ...order(), qrTokenNonce: 'invalid' };
    expect(() =>
      service.verify(service.issue(invalidNonce), invalidNonce),
    ).toThrow();
  });
  it('requires a configured signing secret', () => {
    expect(
      () =>
        new OrderTokenService(
          new ConfigService({ JWT_ACCESS_SECRET: 'short' }),
        ),
    ).toThrow();
  });
  const referenceOrder = () => ({
    ...order(),
    id: 'e47f6994-a303-4a7b-87b0-2386d5198828',
    shopId: '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e',
  });
  it('resolves only the signed order ID for the active shop', () => {
    const saved = referenceOrder();
    expect(
      service.resolveReference(service.issue(saved), saved.shopId),
    ).toEqual({ orderId: saved.id });
    expect(() =>
      service.resolveReference(
        service.issue(saved),
        '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24',
      ),
    ).toThrow();
  });
  it('does not resolve tampered, expired, malformed or table tokens', () => {
    const saved = referenceOrder();
    const token = service.issue(saved);
    for (const raw of [
      '',
      'ORD-000001',
      `${token}x`,
      `x${token}`,
      new TableContextService(config).issue('cafe', 'T12'),
      'a'.repeat(1025),
    ])
      expect(() => service.resolveReference(raw, saved.shopId)).toThrow();
    vi.spyOn(Date, 'now').mockReturnValue(saved.qrTokenExpiresAt.getTime());
    expect(() => service.resolveReference(token, saved.shopId)).toThrow();
  });
  it.each([
    { v: 2 },
    { purpose: 'table-checkout' },
    { orderId: 'invalid' },
    { nonce: 'invalid' },
    { exp: '1792454400000' },
    { totalPrice: '0.01', status: 'CONFIRMED' },
  ])('rejects signed noncanonical or wrong-purpose claims %j', (changes) => {
    const saved = referenceOrder();
    const original = JSON.parse(
      Buffer.from(service.issue(saved).split('.')[0], 'base64url').toString(
        'utf8',
      ),
    ) as Record<string, unknown>;
    const payload = Buffer.from(
      JSON.stringify({ ...original, ...changes }),
    ).toString('base64url');
    const key = createHmac('sha256', config.get<string>('JWT_ACCESS_SECRET')!)
      .update('paserve:order-receipt:v1')
      .digest();
    const raw = `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
    expect(() => service.resolveReference(raw, saved.shopId)).toThrow();
  });
});
