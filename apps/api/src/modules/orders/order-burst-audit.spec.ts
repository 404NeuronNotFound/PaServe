import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { OrderTokenService } from './order-token.service.js';
import { auditOrderTokens } from '../../../test/order-burst.metrics.mjs';

describe('order burst token audit with real backend credentials', () => {
  function fixture() {
    const service = new OrderTokenService(
      new ConfigService({
        JWT_ACCESS_SECRET:
          'test-only-burst-audit-secret-at-least-32-characters',
      }),
    );
    const shops = Array.from({ length: 3 }, () => randomUUID());
    const orders = Array.from({ length: 27 }, (_, i) => ({
      id: randomUUID(),
      shopId: shops[i % 3],
      ...service.metadata(),
      qrTokenRevokedAt: null,
      receiptAccessRevokedAt: null,
    }));
    const receipts = () => {
      const unique = orders.map((order) => ({
        id: order.id,
        qrToken: service.issue(order),
        trackingToken: service.issueTracking(order),
      }));
      return [
        ...unique,
        ...Array.from({ length: 7 }, () => ({ ...unique[0] })),
      ];
    };
    return { service, orders, receipts };
  }
  it('verifies 27 unique credentials and stable replay, including all negative binding controls', () => {
    const f = fixture();
    expect(
      Object.values(auditOrderTokens(f.service, f.orders, f.receipts())).every(
        Boolean,
      ),
    ).toBe(true);
  });
  it('detects forced nonce reuse while credentials remain bound to their own order', () => {
    const f = fixture();
    f.orders[1].qrTokenNonce = f.orders[0].qrTokenNonce;
    const checks = auditOrderTokens(f.service, f.orders, f.receipts());
    expect(checks.uniqueNonces).toBe(false);
    expect(checks.uniqueReceiptTokens).toBe(true);
    expect(checks.uniqueTrackingTokens).toBe(true);
    expect(checks.validBindings).toBe(true);
    expect(checks.rejectOtherOrder).toBe(true);
  });
  it('detects a duplicated receipt credential', () => {
    const f = fixture(),
      receipts = f.receipts();
    receipts[1].qrToken = receipts[0].qrToken;
    const checks = auditOrderTokens(f.service, f.orders, receipts);
    expect(checks.uniqueReceiptTokens).toBe(false);
    expect(checks.validBindings).toBe(false);
  });
  it('rejects expiry instants changed by local timezone decoding', () => {
    const f = fixture(),
      receipts = f.receipts();
    f.orders[0].qrTokenExpiresAt = new Date(
      f.orders[0].qrTokenExpiresAt.getTime() + 8 * 60 * 60 * 1000,
    );
    expect(auditOrderTokens(f.service, f.orders, receipts).validBindings).toBe(
      false,
    );
  });
  it('detects a receipt token substituted for the tracking credential', () => {
    const f = fixture(),
      receipts = f.receipts();
    receipts[1].trackingToken = receipts[1].qrToken;
    const checks = auditOrderTokens(f.service, f.orders, receipts);
    expect(checks.separatePurposes).toBe(false);
    expect(checks.validBindings).toBe(false);
  });
});
