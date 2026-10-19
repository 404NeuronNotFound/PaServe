import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureTrustedProxy } from './trusted-proxy.js';

describe('explicit trusted proxy configuration', () => {
  it.each(['', '   '])(
    'disables proxy trust for an empty configuration',
    (value) => {
      const set = vi.fn();
      configureTrustedProxy(
        { set } as unknown as NestExpressApplication,
        value,
      );
      expect(set).toHaveBeenCalledWith('trust proxy', false);
    },
  );
  it('accepts only explicitly configured addresses and CIDRs', () => {
    const set = vi.fn();
    configureTrustedProxy(
      { set } as unknown as NestExpressApplication,
      '127.0.0.1, 10.0.0.0/24, ::1/128',
    );
    expect(set).toHaveBeenCalledWith('trust proxy', [
      '127.0.0.1',
      '10.0.0.0/24',
      '::1/128',
    ]);
  });
  it.each([
    'true',
    '1',
    'loopback',
    '0.0.0.0/0',
    '::/0',
    '10.0.0.0/33',
    '::1/129',
    '127.0.0.1,',
    'example.com',
    '10.0.0.0/no',
    '::1/1/2',
  ])('fails startup for unsafe or malformed config: %s', (value) => {
    const set = vi.fn();
    expect(() =>
      configureTrustedProxy(
        { set } as unknown as NestExpressApplication,
        value,
      ),
    ).toThrow('TRUSTED_PROXY_CIDRS');
    expect(set).not.toHaveBeenCalled();
  });
});
