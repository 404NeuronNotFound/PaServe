import { Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { ApiCapacityService } from '../src/common/load-shedding/api-capacity.service.js';
import { RequestDeadlineService } from '../src/common/http/request-deadline.service.js';
import { boundedFetch } from '../src/common/http/request-context.js';
import { RateLimit } from '../src/common/rate-limiting/rate-limit.policy.js';

let upstreamUrl: string;
const work = {
  calls: 0,
  completions: 0,
  pending: [] as (() => void)[],
  wait() {
    this.calls++;
    return new Promise<void>((resolve) =>
      this.pending.push(() => {
        this.completions++;
        resolve();
      }),
    );
  },
  release() {
    this.pending.splice(0).forEach((resolve) => resolve());
  },
};

@Controller('timeouts')
class TimeoutController {
  @Get('work')
  async slow() {
    await work.wait();
    return { ok: true };
  }
  @Post('write')
  async write() {
    await work.wait();
    return { saved: true };
  }
  @Get('protected')
  @UseGuards(JwtAuthGuard)
  protected() {
    return this.slow();
  }
  @Get('upstream')
  async upstream() {
    return { body: await (await boundedFetch(upstreamUrl)).text() };
  }
  @Get('stream')
  @RateLimit('stream')
  stream(@Res() response: Response) {
    response.setHeader('Content-Type', 'text/event-stream');
    response.flushHeaders();
    response.write('event: ready\ndata: {}\n\n');
  }
}

describe('request deadlines and real HTTP cancellation', () => {
  let app: NestExpressApplication;
  let upstream: Server;
  let opened = 0,
    closed = 0;
  const auth = { currentUser: vi.fn() };
  const until = async (check: () => boolean) => {
    const end = Date.now() + 3000;
    while (!check()) {
      if (Date.now() >= end) throw new Error('Cancellation did not settle');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const get = (path: string) =>
    request(app.getHttpServer()).get(`/api/v1/timeouts/${path}`);
  beforeAll(async () => {
    upstream = createServer((_, response) => {
      opened++;
      response.on('close', () => {
        closed++;
      });
      // Deliberately stall the body after headers; abort must cover body reads too.
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write('partial');
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve),
    );
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/fixture`;
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TimeoutController],
      providers: [{ provide: AuthService, useValue: auth }],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue(auth)
      .overrideProvider(RequestDeadlineService)
      .useValue(
        new RequestDeadlineService(
          new ConfigService({
            API_READ_TIMEOUT_MS: '250',
            API_WRITE_TIMEOUT_MS: '250',
            API_STREAM_SETUP_TIMEOUT_MS: '250',
          }),
        ),
      )
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(() => {
    work.calls = 0;
    work.completions = 0;
    auth.currentUser.mockReset().mockImplementation(() => work.wait());
  });
  afterEach(async () => {
    work.release();
    await until(
      () => app.get(ApiCapacityService).snapshot().active.total === 0,
    );
  });
  afterAll(async () => {
    await app?.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it('returns a bounded no-store 504 and holds non-cancellable work until actual settlement', async () => {
    const reply = await get('work');
    expect(reply.status).toBe(504);
    expect(reply.body.code).toBe('REQUEST_TIMEOUT');
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(work.calls).toBe(1);
    expect(work.completions).toBe(0);
    expect(app.get(ApiCapacityService).snapshot().active.total).toBe(1);
    work.release();
    await until(
      () => app.get(ApiCapacityService).snapshot().active.total === 0,
    );
    await request(app.getHttpServer()).get('/api/v1').expect(200);
  });

  it('times out a pending guard before the controller and retains its underlying work', async () => {
    await get('protected')
      .set('Authorization', 'Bearer fixture-token')
      .expect(504);
    expect(work.calls).toBe(1);
    expect(app.get(ApiCapacityService).snapshot().active.total).toBe(1);
    work.release();
    await until(
      () => app.get(ApiCapacityService).snapshot().active.total === 0,
    );
    expect(work.calls).toBe(1);
  });

  it('actually aborts a stalled upstream response body on the request deadline', async () => {
    const before = closed;
    await get('upstream').expect(504);
    await until(() => closed > before);
    await until(
      () => app.get(ApiCapacityService).snapshot().active.total === 0,
    );
  });

  it('aborts upstream work when the client disconnects', async () => {
    const before = opened,
      priorClosed = closed;
    const socket = httpRequest({
      host: '127.0.0.1',
      port: (app.getHttpServer().address() as AddressInfo).port,
      path: '/api/v1/timeouts/upstream',
    });
    socket.on('error', () => {});
    socket.end();
    await until(() => opened > before);
    socket.destroy();
    await until(() => closed > priorClosed);
    await until(
      () => app.get(ApiCapacityService).snapshot().active.total === 0,
    );
  });

  it('does not replay a timed-out mutation or claim it rolled back', async () => {
    const reply = await request(app.getHttpServer()).post(
      '/api/v1/timeouts/write',
    );
    expect(reply.status).toBe(504);
    expect(reply.body.message).toContain('Check its outcome');
    expect(work.calls).toBe(1);
    work.release();
    await until(() => work.completions === 1);
    expect(work.calls).toBe(1);
  });

  it('keeps an established SSE stream open beyond its setup deadline, then cleans up on close', async () => {
    const socket = httpRequest({
      host: '127.0.0.1',
      port: (app.getHttpServer().address() as AddressInfo).port,
      path: '/api/v1/timeouts/stream',
    });
    socket.on('error', () => {});
    socket.end();
    await new Promise<void>((resolve) =>
      socket.once('response', (response) => {
        response.resume();
        resolve();
      }),
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(socket.destroyed).toBe(false);
      expect(app.get(ApiCapacityService).snapshot().active.stream).toBe(1);
    } finally {
      socket.destroy();
    }
  });
});
