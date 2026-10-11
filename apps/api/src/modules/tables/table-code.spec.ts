import { generateTableCode } from './table-code.js';
import { TABLE_CODE_PATTERN, publicTablePath } from '@paserve/contracts';

describe('public table codes and URLs', () => {
  it('generates distinct URL-safe codes for new tables', () => {
    const codes = Array.from({ length: 1000 }, () => generateTableCode());
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(TABLE_CODE_PATTERN);
  });
  it('builds customer URLs from a slug and token, without internal IDs', () => {
    const code = generateTableCode();
    const path = publicTablePath('my-cafe', code);
    expect(path).toBe(`/my-cafe/table/${code}`);
    expect(path).not.toContain('75992537-5d60-4d22-8e1e-60a114644681');
  });
  it.each(['T12', 'T012', 'T-75992537-5d60-4d22-8e1e-60a114644681'])(
    'preserves the previously issued code %s',
    (code) => {
      expect(publicTablePath('my-cafe', code)).toBe(`/my-cafe/table/${code}`);
    },
  );
  it.each([
    '75992537-5d60-4d22-8e1e-60a114644681',
    '../app',
    't_bad',
    'T12?role=OWNER',
    'T12\n',
    '',
    'Patio 4',
  ])('rejects invalid codes or internal IDs (%s)', (code) => {
    expect(() => publicTablePath('my-cafe', code)).toThrow();
  });
  it.each([
    '../app',
    'my/cafe',
    'cafe?shop=other',
    'cafe\n',
    '',
    'x'.repeat(101),
  ])('rejects invalid shop slugs (%s)', (slug) => {
    expect(() => publicTablePath(slug, generateTableCode())).toThrow();
  });
});
