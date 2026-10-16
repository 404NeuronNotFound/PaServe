import type { Request, Response } from 'express';
import {
  setTrackingCookie,
  trackingCredential,
} from './guest-tracking-cookie.js';

describe('guest tracking cookies', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('uses an HTTPS-only host cookie in production and preserves its exact saved deadline', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const cookie = vi.fn();
    const expires = new Date('2030-01-01T00:00:00Z');
    setTrackingCookie(
      { cookie } as unknown as Response,
      'cafe',
      'order-id',
      'private-proof',
      expires,
    );
    expect(cookie).toHaveBeenCalledWith('paserve_tracking', 'private-proof', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/v1/menu/cafe/orders/order-id',
      expires,
    });
  });
  it('does not accept query parameters or fall back to a cookie after a malformed authorization header', () => {
    expect(() =>
      trackingCredential({
        headers: {},
        query: { token: 'secret' },
      } as unknown as Request),
    ).toThrow();
    expect(() =>
      trackingCredential({
        headers: {
          authorization: 'Basic invalid',
          cookie: 'paserve_tracking=secret',
        },
      } as unknown as Request),
    ).toThrow();
    expect(
      trackingCredential({
        headers: { cookie: 'other=value; paserve_tracking=secret' },
      } as unknown as Request),
    ).toBe('secret');
  });
});
