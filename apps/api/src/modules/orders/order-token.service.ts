import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Order } from '../../generated/prisma/client.js';

export const ORDER_TOKEN_SECONDS = 7 * 24 * 60 * 60;
type TokenOrder = Pick<
  Order,
  'id' | 'shopId' | 'qrTokenNonce' | 'qrTokenExpiresAt' | 'qrTokenRevokedAt'
>;

@Injectable()
export class OrderTokenService {
  private readonly key: Buffer;
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_ACCESS_SECRET') ?? '';
    if (secret.length < 32)
      throw new Error('JWT_ACCESS_SECRET must contain at least 32 characters.');
    this.key = createHmac('sha256', secret)
      .update('paserve:order-receipt:v1')
      .digest();
  }
  metadata() {
    return {
      qrTokenNonce: randomUUID(),
      qrTokenExpiresAt: new Date(Date.now() + ORDER_TOKEN_SECONDS * 1000),
    };
  }
  issue(order: TokenOrder): string {
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        purpose: 'order-receipt',
        shopId: order.shopId,
        orderId: order.id,
        nonce: order.qrTokenNonce,
        exp: order.qrTokenExpiresAt.getTime(),
      }),
    ).toString('base64url');
    return `${payload}.${createHmac('sha256', this.key).update(payload).digest('base64url')}`;
  }
  // The caller must resolve this persisted order under the target shop first.
  verify(token: string, order: TokenOrder): void {
    const invalid = () =>
      new ForbiddenException({
        code: 'ORDER_TOKEN_INVALID',
        message: 'This order QR is invalid or expired.',
      });
    if (
      typeof token !== 'string' ||
      token.length > 1024 ||
      order.qrTokenRevokedAt ||
      order.qrTokenExpiresAt.getTime() <= Date.now()
    )
      throw invalid();
    const expected = Buffer.from(this.issue(order));
    const received = Buffer.from(token);
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    )
      throw invalid();
  }
}
