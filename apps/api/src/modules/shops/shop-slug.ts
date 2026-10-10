import { randomUUID } from 'node:crypto';

export const SHOP_SLUG_MAX_LENGTH = 80;
export const SHOP_SLUG_MAX_ATTEMPTS = 5;

const reservedNames = new Set([
  'app',
  'api',
  'admin',
  'login',
  'register',
  'shops',
  'menu',
  'connection',
]);
// These Latin letters do not decompose into an ASCII letter with NFKD.
const latinLetters: Record<string, string> = {
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
};

/** A readable ASCII path segment; collision suffixes stay inside the length limit. */
export function generateShopSlug(name: string, collision = false): string {
  let base = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[æœßøłđðþ]/g, (letter) => latinLetters[letter])
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!base) base = 'shop';
  if (reservedNames.has(base)) base = `${base}-shop`;
  const suffix = collision ? `-${randomUUID().slice(0, 8)}` : '';
  return `${base.slice(0, SHOP_SLUG_MAX_LENGTH - suffix.length).replace(/-$/g, '')}${suffix}`;
}
