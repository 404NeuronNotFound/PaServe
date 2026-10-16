import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';

const name = 'paserve_tracking';

/** One host-only cookie per order path; no browser-readable credential store. */
export function setTrackingCookie(
  response: Response,
  slug: string,
  orderId: string,
  token: string,
  expires: Date,
) {
  response.cookie(name, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: `/api/v1/menu/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}`,
    expires,
  });
}

export function trackingCredential(request: Request): string {
  const authorization = request.headers.authorization;
  if (authorization) {
    const match = /^Bearer (\S+)$/i.exec(authorization);
    if (match) return match[1];
  } else {
    const cookies = (request.headers.cookie ?? '')
      .split(';')
      .map((value) => value.trim());
    const matches = cookies.filter((value) => value.startsWith(`${name}=`));
    // Reject ambiguous cookies, rather than selecting an attacker-controlled path.
    if (matches.length === 1) return matches[0].slice(name.length + 1);
  }
  throw new UnauthorizedException({
    code: 'TRACKING_CREDENTIAL_REQUIRED',
    message:
      'Open your private tracking link or ask the counter staff for help.',
  });
}
