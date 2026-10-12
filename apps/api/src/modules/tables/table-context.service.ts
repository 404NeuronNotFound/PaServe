import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { publicTablePath } from '@paserve/contracts';

export const TABLE_CONTEXT_SECONDS = 4 * 60 * 60;
@Injectable()
export class TableContextService {
  private readonly key: Buffer;
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_ACCESS_SECRET') ?? '';
    if (secret.length < 32)
      throw new Error('JWT_ACCESS_SECRET must contain at least 32 characters.');
    this.key = createHmac('sha256', secret)
      .update('paserve:table-context:v1')
      .digest();
  }
  issue(shopSlug: string, code: string): string {
    publicTablePath(shopSlug, code);
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        shopSlug,
        code,
        exp: Math.floor(Date.now() / 1000) + TABLE_CONTEXT_SECONDS,
      }),
    ).toString('base64url');
    return `${payload}.${this.signature(payload).toString('base64url')}`;
  }
  verify(token: string, shopSlug: string, code: string): void {
    const invalid = () =>
      new ForbiddenException({
        code: 'TABLE_CONTEXT_INVALID',
        message:
          'Your table context could not be verified. Scan the original table QR again.',
      });
    try {
      if (
        typeof token !== 'string' ||
        token.length > 1024 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)
      )
        throw invalid();
      const [payload, signature] = token.split('.');
      const received = Buffer.from(signature, 'base64url');
      if (
        received.length !== 32 ||
        received.toString('base64url') !== signature ||
        !timingSafeEqual(received, this.signature(payload))
      )
        throw invalid();
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      if (
        claims.v !== 1 ||
        claims.shopSlug !== shopSlug ||
        claims.code !== code ||
        typeof claims.exp !== 'number' ||
        !Number.isInteger(claims.exp) ||
        claims.exp <= Math.floor(Date.now() / 1000)
      )
        throw invalid();
    } catch {
      throw invalid();
    }
  }
  private signature(payload: string): Buffer {
    return createHmac('sha256', this.key).update(payload).digest();
  }
}
