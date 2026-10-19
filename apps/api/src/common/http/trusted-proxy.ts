import { isIP } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';

export function configureTrustedProxy(
  app: NestExpressApplication,
  value = process.env.TRUSTED_PROXY_CIDRS,
): void {
  if (!value?.trim()) {
    app.set('trust proxy', false);
    return;
  }
  const entries = value.split(',').map((entry) => entry.trim());
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/');
    const version = isIP(address ?? '');
    const bits = version === 4 ? 32 : 128;
    if (
      !version ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > bits))
    ) {
      throw new Error(
        'TRUSTED_PROXY_CIDRS must contain explicit proxy IPs or nonzero CIDR ranges.',
      );
    }
  }
  app.set('trust proxy', entries);
}
