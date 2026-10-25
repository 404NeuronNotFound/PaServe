import { frontendOrigins } from './frontend-origins.js';

describe('frontend origin configuration', () => {
  it('defaults only in development and normalizes explicit origins', () => {
    expect(frontendOrigins(undefined, false)).toEqual([
      'http://localhost:5173',
    ]);
    expect(
      frontendOrigins(
        'https://menu.example.test/, https://menu.example.test',
        true,
      ),
    ).toEqual(['https://menu.example.test']);
  });
  it.each([
    '',
    '*',
    'null',
    'https://*.example.test',
    'https://user:secret@example.test',
    'https://example.test/path',
    'https://example.test?key=private',
    'https://example.test#fragment',
    'https://example.test,',
    'file:///tmp',
    'https://example.test\\evil',
    'https://EXAMPLE.test',
    'https://example.test/../',
  ])('rejects unsafe configuration %s', (value) => {
    expect(() => frontendOrigins(value, false)).toThrow('FRONTEND_ORIGINS');
  });
  it.each([
    undefined,
    'http://menu.example.test',
    'http://localhost:5173',
    'https://localhost',
    'https://foo.localhost',
    'https://127.0.0.2',
    'https://[::1]',
    'https://[::ffff:7f00:1]',
    'https://0.0.0.0',
  ])('fails closed for unsafe production configuration %s', (value) => {
    expect(() => frontendOrigins(value, true)).toThrow('FRONTEND_ORIGINS');
  });
});
