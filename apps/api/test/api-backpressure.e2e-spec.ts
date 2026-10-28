import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Response } from 'express';
import { request as httpRequest, type ClientRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { ApiCapacityService } from '../src/common/load-shedding/api-capacity.service.js';
import { RateLimit } from '../src/common/rate-limiting/rate-limit.policy.js';
import { configureTrustedProxy } from '../src/common/http/trusted-proxy.js';
import { resetRateLimits } from './rate-limit-test-utils.js';
import { JwtService } from '@nestjs/jwt';
import { ShopMembersService } from '../src/modules/shop-members/shop-members.service.js';
import { CashPaymentService } from '../src/modules/orders/cash-payment.service.js';
import { PreparationReadyService } from '../src/modules/orders/preparation-ready.service.js';
import { invalidSession } from '../src/modules/auth/tokens.service.js';

const gate = {
  calls: 0,
  pending: [] as (() => void)[],
  wait() {
    this.calls++;
    return new Promise<{ ok: boolean }>((resolve) =>
      this.pending.push(() => resolve({ ok: true })),
    );
  },
  release() {
    this.pending.splice(0).forEach((resolve) => resolve());
  },
};

@Controller('capacity-test')
class CapacityTestController {
  @Get('slow')
  slow() {
    return gate.wait();
  }

  @Post('auth')
  @RateLimit('login')
  auth() {
    return gate.wait();
  }

  @Get('expensive')
  @RateLimit('reports')
  expensive() {
    return gate.wait();
  }

  @Get('protected')
  @UseGuards(JwtAuthGuard)
  protected() {
    return gate.wait();
  }

  @Get('stream')
  @RateLimit('stream')
  stream(@Res() response: Response) {
    response.setHeader('Content-Type', 'text/event-stream');
    response.flushHeaders();
    response.write('event: ready\ndata: {}\n\n');
  }

  @Get('failure')
  failure() {
    throw new BadRequestException();
  }
}

describe('API backpressure and recovery', () => {
  let app: NestExpressApplication;
  let capacity: ApiCapacityService;
  const database = { $queryRaw: vi.fn().mockResolvedValue([{ healthy: 1 }]) };
  const auth = { currentUser: vi.fn() };
  const memberships = { requireMembership: vi.fn() };
  const cash = { review: vi.fn() };
  const preparation = { ready: vi.fn() };
  const shopId = '10000000-0000-4000-8000-000000000001';
  const orderId = '20000000-0000-4000-8000-000000000002';
  const actorId = '30000000-0000-4000-8000-000000000003';
  let accessToken: string;
  const sockets = new Set<ClientRequest>();
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      if (Date.now() >= deadline)
        throw new Error('Capacity state did not settle');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const get = (path = 'slow', ip = '192.0.2.1') =>
    request(app.getHttpServer())
      .get(`/api/v1/capacity-test/${path}`)
      .set('X-Forwarded-For', ip);
  const open = (path: string, ip = '192.0.2.1') => {
    const address = app.getHttpServer().address() as AddressInfo;
    const socket = httpRequest({
      host: '127.0.0.1',
      port: address.port,
      path: `/api/v1/capacity-test/${path}`,
      headers: {
        'X-Forwarded-For': ip,
        Authorization: 'Bearer fixture-token',
      },
    });
    socket.on('error', () => {});
    sockets.add(socket);
    socket.end();
    return socket;
  };
  const overload = (reply: request.Response) => {
    expect(reply.status).toBe(503);
    expect(reply.body.code).toBe('API_OVERLOADED');
    expect(reply.headers['retry-after']).toBe('1');
    expect(reply.headers['cache-control']).toBe('no-store');
  };

  beforeAll(async () => {
    capacity = new ApiCapacityService(
      new ConfigService({
        API_MAX_IN_FLIGHT: '6',
        API_RESERVED_CRITICAL: '1',
        API_MAX_IN_FLIGHT_PER_IP: '3',
        API_RESERVED_CRITICAL_PER_IP: '1',
        API_MAX_AUTH_IN_FLIGHT: '1',
        API_MAX_STREAMS: '1',
        API_MAX_EXPENSIVE_IN_FLIGHT: '1',
      }),
    );
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [CapacityTestController],
      providers: [{ provide: AuthService, useValue: auth }],
    })
      .overrideProvider(PrismaService)
      .useValue(database)
      .overrideProvider(AuthService)
      .useValue(auth)
      .overrideProvider(ApiCapacityService)
      .useValue(capacity)
      .overrideProvider(ShopMembersService)
      .useValue(memberships)
      .overrideProvider(CashPaymentService)
      .useValue(cash)
      .overrideProvider(PreparationReadyService)
      .useValue(preparation)
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');
    configureTrustedProxy(app, '127.0.0.0/8');
    await app.listen(0, '127.0.0.1');
    accessToken = new JwtService().sign(
      { sub: actorId, sid: 'fixture-session', type: 'access' },
      {
        secret: app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET'),
        algorithm: 'HS256',
        issuer: 'paserve-api',
        audience: 'paserve:web',
        expiresIn: 60,
      },
    );
  });
  beforeEach(() => {
    resetRateLimits(app);
    gate.calls = 0;
    database.$queryRaw.mockClear();
    auth.currentUser.mockReset().mockImplementation(() => gate.wait());
    memberships.requireMembership
      .mockReset()
      .mockResolvedValue({ shopId, role: 'OWNER' });
    cash.review.mockReset().mockResolvedValue({ fixture: 'cashier-review' });
    preparation.ready
      .mockReset()
      .mockResolvedValue({ preparationStatus: 'READY' });
    configureTrustedProxy(app, '127.0.0.0/8');
  });
  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    gate.release();
    await until(() => capacity.snapshot().active.total === 0);
    expect(capacity.snapshot().trackedClients).toBe(0);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('rejects global overload before authentication or controller work, then recovers', async () => {
    const active = Array.from({ length: 4 }, (_, index) =>
      get('slow', `192.0.2.${index + 1}`).then((reply) => reply.status),
    );
    await until(() => gate.calls === 4);
    overload(
      await get('protected', '192.0.2.9').set(
        'Authorization',
        'Bearer fixture-token',
      ),
    );
    expect(auth.currentUser).not.toHaveBeenCalled();
    expect(gate.calls).toBe(4);
    gate.release();
    expect(await Promise.all(active)).toEqual([200, 200, 200, 200]);
    await get('failure', '192.0.2.9').expect(400);
    expect(capacity.snapshot().active.total).toBe(0);
  });

  it('bounds each IP across routes and leaves room for other clients', async () => {
    const active = [get().then(() => {}), get().then(() => {})];
    await until(() => gate.calls === 2);
    overload(await get('failure').set('X-Shop-Id', 'another-shop'));
    await get('failure', '192.0.2.2').expect(400);
    gate.release();
    await Promise.all(active);
  });

  it('ignores forged forwarding headers from an untrusted direct connection', async () => {
    configureTrustedProxy(app, '');
    const active = [
      get('slow', '192.0.2.1').then(() => {}),
      get('slow', '192.0.2.2').then(() => {}),
    ];
    await until(() => gate.calls === 2);
    overload(await get('failure', '192.0.2.3'));
    gate.release();
    await Promise.all(active);
  });

  it.each(['auth', 'expensive'])(
    'caps %s traffic separately without filling normal capacity',
    async (path) => {
      const first =
        path === 'auth'
          ? request(app.getHttpServer())
              .post('/api/v1/capacity-test/auth')
              .set('X-Forwarded-For', '192.0.2.1')
          : get(path);
      const active = first.then((reply) => reply.status);
      await until(() => gate.calls === 1);
      const rejected =
        path === 'auth'
          ? await request(app.getHttpServer())
              .post('/api/v1/capacity-test/auth')
              .set('X-Forwarded-For', '192.0.2.2')
          : await get(path, '192.0.2.2');
      overload(rejected);
      await get('failure', '192.0.2.3').expect(400);
      gate.release();
      expect(await active).toBe(path === 'auth' ? 201 : 200);
    },
  );

  it('reserves database readiness and keeps liveness dependency-free under ordinary overload', async () => {
    const active = Array.from({ length: 4 }, (_, index) =>
      get('slow', `192.0.2.${index + 1}`).then(() => {}),
    );
    await until(() => gate.calls === 4);
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Forwarded-For', '192.0.2.9')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('X-Forwarded-For', '192.0.2.9')
      .expect(200, { api: 'ok' });
    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
    gate.release();
    await Promise.all(active);
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(database.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it.each(['slow', 'protected'])(
    'holds capacity after disconnect during %s work until it actually settles',
    async (path) => {
      const socket = open(path);
      await until(() => gate.calls === 1);
      socket.destroy();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(capacity.snapshot().active.total).toBe(1);
      expect(capacity.snapshot().trackedClients).toBe(1);
      gate.release();
      await until(() => capacity.snapshot().active.total === 0);
      // A disconnected guard must never proceed to its controller's next DB operation.
      expect(gate.calls).toBe(1);
    },
  );

  it('holds a bounded stream reservation until close and keeps normal routes available', async () => {
    const socket = open('stream');
    await new Promise<void>((resolve) =>
      socket.once('response', (response) => {
        response.resume();
        resolve();
      }),
    );
    expect(capacity.snapshot().active.stream).toBe(1);
    overload(await get('stream', '192.0.2.2'));
    await get('failure', '192.0.2.3').expect(400);
    socket.destroy();
    await until(() => capacity.snapshot().active.total === 0);
  });

  it('sheds a concurrent burst without growing client state or starting extra work', async () => {
    const active = Array.from({ length: 4 }, (_, index) =>
      get('slow', `192.0.2.${index + 1}`).then(() => {}),
    );
    await until(() => gate.calls === 4);
    const burst = await Promise.all(
      Array.from({ length: 64 }, (_, index) =>
        get('protected', `198.51.100.${index + 1}`).set(
          'Authorization',
          'Bearer fixture-token',
        ),
      ),
    );
    burst.forEach(overload);
    expect(capacity.snapshot().trackedClients).toBe(4);
    expect(capacity.snapshot().active.total).toBe(4);
    expect(auth.currentUser).not.toHaveBeenCalled();
    expect(gate.calls).toBe(4);
    gate.release();
    await Promise.all(active);
    await get('failure').expect(400);
  });

  it('serves real cashier and order-update routes while ordinary global and shared-IP budgets are full', async () => {
    const active = ['192.0.2.1', '192.0.2.1', '192.0.2.2', '192.0.2.3'].map(
      (ip) => get('slow', ip).then(() => {}),
    );
    await until(() => gate.calls === 4);
    overload(await get('failure', '192.0.2.1'));
    auth.currentUser.mockResolvedValue({ id: actorId });
    memberships.requireMembership.mockResolvedValue({
      shopId,
      role: 'CASHIER',
    });
    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/orders/${orderId}/cashier-review`)
      .set('X-Forwarded-For', '192.0.2.1')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200, { fixture: 'cashier-review' });
    expect(cash.review).toHaveBeenCalledWith(
      actorId,
      shopId,
      orderId,
      undefined,
      true,
    );
    memberships.requireMembership.mockResolvedValue({
      shopId,
      role: 'KITCHEN',
    });
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/orders/${orderId}/mark-ready`)
      .set('X-Forwarded-For', '192.0.2.1')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(200, { preparationStatus: 'READY' });
    expect(preparation.ready).toHaveBeenCalledWith(actorId, shopId, orderId);
    expect(memberships.requireMembership).toHaveBeenCalledWith(actorId, shopId);
    expect(capacity.snapshot().active.total).toBe(4);
    gate.release();
    await Promise.all(active);
  });

  it('cannot claim staff reserves with forged credentials, priority headers or a public route', async () => {
    const active = Array.from({ length: 4 }, (_, index) =>
      get('slow', `192.0.2.${index + 1}`).then(() => {}),
    );
    await until(() => gate.calls === 4);
    overload(
      await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/orders/${orderId}/cashier-review`)
        .set('X-Forwarded-For', '192.0.2.9')
        .set('Authorization', 'Bearer forged-token')
        .set('X-Priority', 'critical'),
    );
    overload(
      await get('protected', '192.0.2.9')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Priority', 'critical'),
    );
    expect(auth.currentUser).not.toHaveBeenCalled();
    expect(cash.review).not.toHaveBeenCalled();
    gate.release();
    await Promise.all(active);
  });

  it('still enforces revoked sessions and live shop permissions in the reserved lane', async () => {
    const active = Array.from({ length: 4 }, (_, index) =>
      get('slow', `192.0.2.${index + 1}`).then(() => {}),
    );
    await until(() => gate.calls === 4);
    const review = () =>
      request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/orders/${orderId}/cashier-review`)
        .set('X-Forwarded-For', '192.0.2.9')
        .set('Authorization', `Bearer ${accessToken}`);
    auth.currentUser.mockRejectedValueOnce(invalidSession());
    await review().expect(401);
    auth.currentUser.mockResolvedValue({ id: actorId });
    memberships.requireMembership.mockResolvedValue({
      shopId,
      role: 'KITCHEN',
    });
    await review().expect(403);
    expect(cash.review).not.toHaveBeenCalled();
    expect(capacity.snapshot().active.critical).toBe(0);
    gate.release();
    await Promise.all(active);
  });

  it('bounds the staff reserve and DB probe separately while liveness survives full saturation', async () => {
    const active = Array.from({ length: 4 }, (_, index) =>
      get('slow', `192.0.2.${index + 1}`).then(() => {}),
    );
    await until(() => gate.calls === 4);
    auth.currentUser.mockResolvedValue({ id: actorId });
    cash.review.mockImplementation(() => gate.wait());
    const staff = request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/orders/${orderId}/cashier-review`)
      .set('X-Forwarded-For', '192.0.2.8')
      .set('Authorization', `Bearer ${accessToken}`)
      .then((reply) => reply.status);
    await until(() => gate.calls === 5);
    overload(
      await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/orders/${orderId}/cashier-review`)
        .set('X-Forwarded-For', '192.0.2.9')
        .set('Authorization', `Bearer ${accessToken}`),
    );
    database.$queryRaw.mockImplementationOnce(() => gate.wait());
    const probe = request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Forwarded-For', '192.0.2.10')
      .then((reply) => reply.status);
    await until(() => gate.calls === 6);
    overload(
      await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('X-Forwarded-For', '192.0.2.11'),
    );
    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(capacity.snapshot().active.total).toBe(6);
    gate.release();
    expect(await staff).toBe(200);
    expect(await probe).toBe(200);
    await Promise.all(active);
  });

  it('releases reservations for rate-limit and guard errors without bypassing normal 429s', async () => {
    auth.currentUser.mockRejectedValue(new BadRequestException());
    await get('protected')
      .set('Authorization', 'Bearer fixture-token')
      .expect(400);
    for (let index = 0; index < 11; index++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .expect(index < 10 ? 403 : 429);
    }
    expect(capacity.snapshot().active.total).toBe(0);
  });
});
