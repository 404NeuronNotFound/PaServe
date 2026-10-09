import { createHash } from 'node:crypto';
import { PRODUCT_LIMITS } from '@paserve/contracts';

export function productSlug(name: string): string {
  const normalized = name
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFKC')
    .toLowerCase();
  const ascii = normalized
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return ascii
    ? ascii.slice(0, PRODUCT_LIMITS.slugMax).replace(/-$/g, '')
    : `product-${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
}
