import { generateShopSlug, SHOP_SLUG_MAX_LENGTH } from './shop-slug.js';

describe('Shop slug generation', () => {
  it.each([
    [' Café North ', 'cafe-north'],
    ['Cafe\u0301 North', 'cafe-north'],
    ["Baker's Café", 'bakers-cafe'],
    ['Baker’s Café', 'bakers-cafe'],
    ['  COFFEE  &  FOOD / NORTH!! ', 'coffee-food-north'],
    ['Straße & Łódź', 'strasse-lodz'],
    ['Æsir / Œuf / Øster', 'aesir-oeuf-oster'],
    ['Ｃａｆｅ １２３', 'cafe-123'],
    ['North 🥐 Café', 'north-cafe'],
    ['API', 'api-shop'],
    ['admin', 'admin-shop'],
    ['茶馆', 'shop'],
    ['☕️ !!!', 'shop'],
  ])('generates a readable, URL-safe slug for %s', (name, expected) => {
    const slug = generateShopSlug(name);
    expect(slug).toBe(expected);
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(encodeURIComponent(slug)).toBe(slug);
  });

  it('caps long slugs without leaving a trailing separator', () => {
    const slug = generateShopSlug(`${'a'.repeat(79)} North Café`);
    expect(slug).toBe('a'.repeat(79));
    expect(slug.length).toBeLessThanOrEqual(SHOP_SLUG_MAX_LENGTH);
  });

  it('reserves room for a safe suffix when a long name collides', () => {
    const slug = generateShopSlug('a'.repeat(120), true);
    expect(slug).toMatch(/^[a-z]{71}-[a-f0-9]{8}$/);
    expect(slug.length).toBe(SHOP_SLUG_MAX_LENGTH);
  });

  it('suffixes even fallback names after a collision', () => {
    expect(generateShopSlug('茶馆', true)).toMatch(/^shop-[a-f0-9]{8}$/);
  });
});
