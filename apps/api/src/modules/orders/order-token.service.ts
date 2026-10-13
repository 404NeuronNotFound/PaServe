import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Order } from '../../generated/prisma/client.js';
import { isUUID } from 'class-validator';

export const ORDER_TOKEN_SECONDS = 7 * 24 * 60 * 60;
type TokenOrder = Pick<
  Order,
  'id' | 'shopId' | 'qrTokenNonce' | 'qrTokenExpiresAt' | 'qrTokenRevokedAt'
>;
const invalidOrderToken = () =>
  new ForbiddenException({
    code: 'ORDER_TOKEN_INVALID',
    message: 'This order QR is invalid or expired.',
  });

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
  /** Resolve only a signed reference within the caller's validated route shop.
   * Persisted expiry, revocation and canonical binding still require verify(). */
  resolveReference(token: string, shopId: string): { orderId: string } {
    if (
      typeof token !== 'string' ||
      token.length > 1024 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$(?![\s\S])/.test(token)
    )
      throw invalidOrderToken();
    const [payload, signature] = token.split('.');
    const expected = createHmac('sha256', this.key)
      .update(payload)
      .digest('base64url');
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
      throw invalidOrderToken();
    try {
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      if (
        !claims ||
        typeof claims !== 'object' ||
        Array.isArray(claims) ||
        Object.keys(claims).sort().join(',') !==
          'exp,nonce,orderId,purpose,shopId,v' ||
        claims.v !== 1 ||
        claims.purpose !== 'order-receipt' ||
        claims.shopId !== shopId ||
        typeof claims.orderId !== 'string' ||
        !isUUID(claims.orderId) ||
        typeof claims.nonce !== 'string' ||
        !isUUID(claims.nonce) ||
        typeof claims.exp !== 'number' ||
        !Number.isSafeInteger(claims.exp) ||
        claims.exp <= Date.now()
      )
        throw invalidOrderToken();
      return { orderId: claims.orderId };
    } catch {
      throw invalidOrderToken();
    }
  }
  // The caller must resolve this persisted order under the target shop first.
  verify(token: string, order: TokenOrder): void {
    const expiresAt =
      order.qrTokenExpiresAt instanceof Date
        ? order.qrTokenExpiresAt.getTime()
        : Number.NaN;
    if (
      typeof token !== 'string' ||
      token.length > 1024 ||
      order.qrTokenRevokedAt ||
      typeof order.qrTokenNonce !== 'string' ||
      !isUUID(order.qrTokenNonce) ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= Date.now()
    )
      throw invalidOrderToken();
    const expected = Buffer.from(this.issue(order));
    const received = Buffer.from(token);
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    )
      throw invalidOrderToken();
  }
}
