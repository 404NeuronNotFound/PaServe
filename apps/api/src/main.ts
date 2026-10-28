import { configureSecurityHeaders } from './common/http/security-headers.js';
import { configureTrustedProxy } from './common/http/trusted-proxy.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureRequestBody } from './common/http/request-body.js';
import { frontendOrigins } from './common/http/frontend-origins.js';
import { configureServerTimeouts } from './common/http/server-timeouts.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  configureSecurityHeaders(app);
  configureTrustedProxy(app);
  configureRequestBody(app);
  configureServerTimeouts(app);

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: frontendOrigins(
      process.env.FRONTEND_ORIGINS,
      process.env.NODE_ENV === 'production',
    ),
    credentials: true,
    exposedHeaders: [
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
  });

  // Use loopback behind a colocated edge, or a private container/network interface.
  // An unset address retains the hosting platform's existing bind behavior.
  if (process.env.API_BIND_ADDRESS) {
    await app.listen(process.env.PORT ?? 3000, process.env.API_BIND_ADDRESS);
  } else {
    await app.listen(process.env.PORT ?? 3000);
  }
}

bootstrap().catch(() => {
  console.error(
    'PaServe API failed to start. Check the backend configuration.',
  );
  process.exitCode = 1;
});
