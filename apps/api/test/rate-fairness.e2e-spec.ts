import {
  Controller,
  Get,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { ShopMembersModule } from '../src/modules/shop-members/shop-members.module.js';
import { ShopMembersService } from '../src/modules/shop-members/shop-members.service.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { ShopMembershipGuard } from '../src/modules/shop-members/guards/shop-membership.guard.js';
import { CriticalCapacity } from '../src/common/load-shedding/critical-capacity.js';
import { TrafficFairnessService } from '../src/common/load-shedding/traffic-fairness.service.js';
import { configureTrustedProxy } from '../src/common/http/trusted-proxy.js';
import { resetRateLimits } from './rate-limit-test-utils.js';
import { MenuReadCapacity } from '../src/common/load-shedding/menu-read-capacity.js';
import { ApiCapacityService } from '../src/common/load-shedding/api-capacity.service.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';
import { PublicMenuRepository } from '../src/modules/categories/public-menu.repository.js';
import { PublicProductService } from '../src/modules/products/public-product.service.js';

const gate = {
  calls: 0,
  pending: [] as (() => void)[],
  read(hold: string) {
    this.calls++;
    return hold
      ? new Promise((resolve) => this.pending.push(() => resolve({ ok: true })))
      : { ok: true };
  },
  release() {
    this.pending.splice(0).forEach((finish) => finish());
  },
};
@Controller('fairness-fixture/menu')
class PublicFixture {
  @Get(':shopSlug')
  @MenuReadCapacity()
  read(@Query('hold') hold: string) {
    return gate.read(hold);
  }
}
@Controller('fairness-fixture/shops')
@UseGuards(JwtAuthGuard, ShopMembershipGuard)
class PrivateFixture {
  @Get(':shopId')
  read(@Query('hold') hold: string) {
    return gate.read(hold);
  }
  @Get(':shopId/critical')
  @CriticalCapacity()
  critical() {
    return { ok: true };
  }
}

describe('Fairness through real HTTP admission and guards', () => {
  let app: NestExpressApplication;
  let fairness: TrafficFairnessService;
  let criticalToken: string;
  const a = '10000000-0000-4000-8000-000000000001';
  const b = '10000000-0000-4000-8000-000000000002';
  const jobs: Promise<request.Response>[] = [];
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      if (Date.now() > deadline)
        throw new Error('Fairness fixture did not settle');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const get = (path: string, ip = '192.0.2.1', actor?: string) => {
    const read = request(app.getHttpServer())
      .get(`/api/v1/fairness-fixture/${path}`)
      .set('X-Forwarded-For', ip);
    if (actor) read.set('Authorization', `Bearer ${actor}`);
    return read;
  };
  const limited = (result: request.Response) => {
    expect(result.status).toBe(429);
    expect(result.body.code).toBe('FAIRNESS_LIMIT_EXCEEDED');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(Number(result.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  };
  beforeAll(async () => {
    fairness = new TrafficFairnessService(
      new ConfigService({
        API_FAIR_TENANT_IN_FLIGHT: 4,
        API_FAIR_ACCOUNT_IN_FLIGHT: 2,
        API_FAIR_TENANT_BURST: 6,
        API_FAIR_TENANT_PER_MINUTE: 60,
      }),
    );
    const module = await Test.createTestingModule({
      imports: [AppModule, ShopMembersModule],
      controllers: [PublicFixture, PrivateFixture],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: vi.fn().mockResolvedValue([{ healthy: 1 }]) })
      .overrideProvider(TrafficFairnessService)
      .useValue(fairness)
      .overrideProvider(PublicMenuRepository)
      .useValue({
        read: async (slug: string) => ({
          name: 'Fixture shop',
          slug,
          categories: [],
          products: [],
        }),
      })
      .overrideProvider(PublicProductService)
      .useValue({ details: async () => ({ ok: true }) })
      .overrideProvider(OrdersService)
      .useValue({
        create: async (_slug: string, input: { requestId: string }) => {
          await gate.read('1');
          return {
            order: { id: input.requestId, qrTokenExpiresAt: null },
            trackingToken: 'fixture-only',
          };
        },
      })
      .overrideProvider(AuthService)
      .useValue({
        login: async () => {
          await gate.read('1');
          return {
            response: { accessToken: 'fixture-only', user: { id: a } },
            refreshToken: 'fixture-only',
            expiresAt: new Date(Date.now() + 60000),
          };
        },
        currentUser: async (token: string) => {
          if (token === 'bad') throw new UnauthorizedException();
          return { id: token };
        },
      })
      .overrideProvider(ShopMembersService)
      .useValue({
        requireMembership: async (_user: string, shopId: string) => ({
          shopId,
          role: 'OWNER',
        }),
      })
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');
    configureTrustedProxy(app, '127.0.0.0/8');
    await app.listen(0, '127.0.0.1');
    criticalToken = new JwtService().sign(
      { sub: a, sid: b, type: 'access' },
      {
        secret: app.get(ConfigService).getOrThrow('JWT_ACCESS_SECRET'),
        algorithm: 'HS256',
        issuer: 'paserve-api',
        audience: 'paserve:web',
        expiresIn: 300,
      },
    );
  });
  beforeEach(() => {
    gate.calls = 0;
    resetRateLimits(app);
  });
  afterEach(async () => {
    gate.release();
    await Promise.all(jobs.splice(0));
    await until(() => fairness.snapshot().activeScopeLeases === 0);
  });
  afterAll(async () => {
    await app.close();
  });

  it('limits one public shop across IPs while another shop, staff and health remain responsive', async () => {
    for (let i = 0; i < 3; i++)
      jobs.push(
        get('menu/large?hold=1', `192.0.2.${i + 1}`).then((result) => result),
      );
    await until(() => gate.calls === 3);
    limited(await get('menu/large', '192.0.2.40').set('X-Shop-Id', b));
    expect(gate.calls).toBe(3);
    await get('menu/small', '192.0.2.41').expect(200);
    await get(`shops/${a}`, '192.0.2.42', 'cashier').expect(200);
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
  });
  it('preserves critical capacity inside a verified tenant under ordinary saturation', async () => {
    for (let i = 0; i < 3; i++)
      jobs.push(
        get(`shops/${a}?hold=1`, `192.0.2.${i + 1}`, `owner-${i}`).then(
          (result) => result,
        ),
      );
    await until(() => gate.calls === 3);
    limited(await get(`shops/${a}`, '192.0.2.50', 'another-owner'));
    await get(`shops/${a}/critical`, '192.0.2.51', criticalToken).expect(200);
    await get(`shops/${b}`, '192.0.2.52', 'unrelated-owner').expect(200);
  });
  it('limits one account across shops without grouping all users behind a shared IP', async () => {
    jobs.push(
      get(`shops/${a}?hold=1`, '192.0.2.1', 'one-owner').then(
        (result) => result,
      ),
    );
    await until(() => gate.calls === 1);
    limited(await get(`shops/${b}`, '192.0.2.80', 'one-owner'));
    await get(`shops/${b}`, '192.0.2.1', 'second-owner').expect(200);
  });
  it('aggregates rate across source rotation and recovers after refill', async () => {
    for (let i = 0; i < 6; i++)
      await get('menu/burst', `192.0.2.${i + 1}`).expect(200);
    limited(await get('menu/burst', '192.0.2.50'));
    await get('menu/quiet', '192.0.2.51').expect(200);
    await new Promise((resolve) => setTimeout(resolve, 1050));
    await get('menu/burst', '192.0.2.52').expect(200);
  });
  it('cannot select a private victim budget using headers, body or an invalid session', async () => {
    const before = fairness.snapshot().trackedScopes;
    await get(`shops/${a}`, '192.0.2.1', 'bad')
      .set('X-Shop-Id', b)
      .send({ shopId: b, user: { id: 'victim' } })
      .expect(401);
    expect(fairness.snapshot().trackedScopes).toBe(before);
    await get(`shops/${a}`, '192.0.2.1').expect(401);
  });
  it('does not release a disconnected request while its handler is still running', async () => {
    const address = app.getHttpServer().address() as AddressInfo;
    const socket = httpRequest({
      host: '127.0.0.1',
      port: address.port,
      path: '/api/v1/fairness-fixture/menu/disconnect?hold=1',
    });
    socket.on('error', () => {});
    socket.end();
    await until(() => gate.calls === 1);
    socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fairness.snapshot().activeScopeLeases).toBe(1);
    gate.release();
    await until(() => fairness.snapshot().activeScopeLeases === 0);
    await get('menu/disconnect').expect(200);
  });

  const submit = (shop: string, ip: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/menu/${shop}/orders`)
      .set('X-Forwarded-For', ip)
      .send({
        requestId: a,
        mode: 'TAKEOUT',
        items: [{ productId: b, quantity: 1, variantIds: [], addOnIds: [] }],
      });
  const menu = (shop = 'large', ip = '192.0.2.1') =>
    request(app.getHttpServer())
      .get(`/api/v1/menu/${shop}`)
      .set('X-Forwarded-For', ip);

  it('serves the real menu and product GETs after same-shop order slots are saturated', async () => {
    jobs.push(submit('large', '192.0.2.1').then((result) => result));
    jobs.push(submit('large', '192.0.2.2').then((result) => result));
    await until(() => gate.calls === 2);
    limited(await submit('large', '192.0.2.3').set('X-Priority', 'menu'));
    await menu().expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/menu/large/products/${b}`)
      .expect(200);
    await get(`shops/${a}/critical`, '192.0.2.10', criticalToken).expect(200);
  });

  it('keeps menu tokens independent after exhausting the same-shop order rate', async () => {
    for (let i = 0; i < 6; i++) {
      const pending = submit('large', `192.0.2.${i + 1}`).then(
        (result) => result,
      );
      await until(() => gate.calls === i + 1);
      gate.release();
      expect((await pending).status).toBe(201);
    }
    limited(await submit('large', '192.0.2.40'));
    await menu().expect(200);
    await menu('another-shop').expect(200);
  });

  it('preserves the real menu during combined distributed order and login saturation', async () => {
    const capacity = app.get(ApiCapacityService);
    // Real login route and credential admission; gated identity service avoids
    // password hashing or providers while preserving request-work occupancy.
    for (let i = 0; i < 32; i++)
      jobs.push(
        request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', `198.51.100.${i + 1}`)
          .set('X-PaServe-Client', 'web')
          .send({
            email: `flood${i}@example.com`,
            password: 'fixture-valid-passphrase',
          })
          .then((result) => result),
      );
    await until(() => capacity.snapshot().active.auth === 2);
    const orderCount = capacity.limits.general - capacity.menuReserve - 2;
    for (let i = 0; i < orderCount; i++)
      jobs.push(
        submit(`flood-${i}`, `203.0.113.${i + 1}`).then((result) => result),
      );
    await until(() => gate.calls === orderCount + 2);
    const rejected = await submit('extra-source', '192.0.2.90');
    expect(rejected.status).toBe(503);
    await menu('large', '192.0.2.91').expect(200);
    await get(`shops/${a}/critical`, '192.0.2.92', criticalToken).expect(200);
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(capacity.snapshot().active.total).toBeGreaterThan(90);
  });

  it('preserves a menu slot for clients sharing the order-flood IP', async () => {
    const capacity = app.get(ApiCapacityService);
    const count =
      capacity.limits.perIp -
      capacity.criticalPerIpReserve -
      capacity.menuPerIpReserve;
    for (let i = 0; i < count; i++)
      jobs.push(submit(`shared-${i}`, '192.0.2.60').then((result) => result));
    await until(() => gate.calls === count);
    expect((await submit('shared-overflow', '192.0.2.60')).status).toBe(503);
    await menu('large', '192.0.2.60').expect(200);
  });
});
