import { createHash } from 'node:crypto';
import { CATEGORY_LIMITS } from '@paserve/contracts';

export function categorySlug(name: string): string {
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
  // Stable fallback supports non-Latin names without making them all collide.
  return ascii
    ? ascii.slice(0, CATEGORY_LIMITS.slugMax).replace(/-$/g, '')
    : `category-${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
}
