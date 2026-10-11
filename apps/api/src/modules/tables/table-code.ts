import { randomBytes } from 'node:crypto';

/** Public locator only: contains no table/shop IDs, labels or authorization claims. */
export function generateTableCode(): string {
  return `t_${randomBytes(16).toString('hex')}`;
}
