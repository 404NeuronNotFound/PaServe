import { categorySlug } from './category-slug.js';
describe('category slugs', () => {
  it.each([
    [' Coffee ', 'coffee'],
    ['Café & Meals', 'cafe-meals'],
    ['Chef’s Favorites', 'chefs-favorites'],
  ])('normalizes %s', (name, expected) => {
    expect(categorySlug(name)).toBe(expected);
  });
  it('supports distinct non-Latin names with stable URL-safe fallback', () => {
    expect(categorySlug('咖啡')).toMatch(/^category-[a-f0-9]{16}$/);
    expect(categorySlug('咖啡')).toBe(categorySlug(' 咖啡 '));
    expect(categorySlug('咖啡')).not.toBe(categorySlug('甜点'));
  });
  it('bounds long slugs without a trailing separator', () => {
    expect(categorySlug('long-name-'.repeat(20)).length).toBeLessThanOrEqual(
      80,
    );
    expect(categorySlug('long-name-'.repeat(20))).not.toMatch(/-$/);
  });
});
