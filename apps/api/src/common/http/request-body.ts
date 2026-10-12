import type { NestExpressApplication } from '@nestjs/platform-express';

// Accommodate 100 configured order lines while keeping JSON requests bounded.
export function configureRequestBody(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: '1mb' });
}
