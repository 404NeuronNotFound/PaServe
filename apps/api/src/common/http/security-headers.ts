import type { Request, Response, NextFunction } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** API document policy; the frontend host owns its separate HTML CSP. */
export function configureSecurityHeaders(
  app: NestExpressApplication,
  production = process.env.NODE_ENV === 'production',
): void {
  app.useSecurityHeaders({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    xFrameOptions: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    // Keep cross-origin public media usable. This app does not require isolation.
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: production
      ? { maxAge: 31_536_000, includeSubDomains: false, preload: false }
      : false,
  });
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    next();
  });
}
