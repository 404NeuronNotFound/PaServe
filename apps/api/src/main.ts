import { configureSecurityHeaders } from './common/http/security-headers.js';
import { configureTrustedProxy } from './common/http/trusted-proxy.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureRequestBody } from './common/http/request-body.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureSecurityHeaders(app);
  configureTrustedProxy(app);
  configureRequestBody(app);

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: (process.env.FRONTEND_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((value) => value.trim()),
    credentials: true,
    exposedHeaders: [
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
  });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch(() => {
  console.error(
    'PaServe API failed to start. Check the backend configuration.',
  );
  process.exitCode = 1;
});
