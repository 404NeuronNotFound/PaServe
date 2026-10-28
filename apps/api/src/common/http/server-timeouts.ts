import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';

export function configureServerTimeouts(app: NestExpressApplication): void {
  const server = app.getHttpServer() as Server;
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  // Includes stalled connections; greater than every normal response deadline.
  // SSE emits a heartbeat every 15 seconds and has its own 60-second lifetime.
  server.setTimeout(60_000);
}
