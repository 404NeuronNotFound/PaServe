import {
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';

type Result = { hits: number; retry: number; accepted: boolean };

/** Database time and atomic SQL operations keep budgets consistent across instances. */
@Injectable()
export class SharedSecurityState {
  readonly enabled: boolean;
  private readonly secret: string;

  constructor(
    config: ConfigService,
    @Optional() private readonly db?: PrismaService,
  ) {
    const mode = config.get<string>('SECURITY_STATE_MODE') ?? 'local';
    if (!['local', 'postgres'].includes(mode))
      throw new Error('SECURITY_STATE_MODE must be local or postgres');
    this.enabled = mode === 'postgres';
    if (config.get<string>('VERCEL') === '1' && !this.enabled)
      throw new Error('Vercel requires SECURITY_STATE_MODE=postgres');
    this.secret = config.get<string>('SECURITY_STATE_SECRET')?.trim() ?? '';
    if (this.enabled && (this.secret.length < 32 || !db))
      throw new Error(
        'Shared security requires a database and SECURITY_STATE_SECRET of at least 32 characters',
      );
  }

  key(value: string) {
    return createHmac('sha256', this.secret).update(value).digest('hex');
  }

  async operate(
    key: string,
    operation: 'read' | 'hit' | 'rate' | 'reserve' | 'delete',
    ttl = 900_000,
    limit = 20,
  ): Promise<Result> {
    try {
      const rows = await this.db!.$queryRaw<Result[]>`
        SELECT * FROM public.paserve_security_state(${this.key(key)}, ${operation}, ${ttl}::integer, ${limit}::integer)
      `;
      if (!rows[0]) throw new Error('Missing security state result');
      return rows[0];
    } catch {
      // Never silently fall back to fresh local budgets on provider/schema failure.
      throw new ServiceUnavailableException({
        code: 'SECURITY_STATE_UNAVAILABLE',
        message:
          'Security checks are temporarily unavailable. Please try again shortly.',
      });
    }
  }
}
