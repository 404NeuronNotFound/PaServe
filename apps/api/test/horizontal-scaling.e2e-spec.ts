import {
  Controller,
  Get,
  Req,
  UseGuards,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { TokensService } from '../src/modules/auth/tokens.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../src/modules/auth/guards/jwt-auth.guard.js';
import { ApiObservabilityService } from '../src/common/observability/api-observability.service.js';

@Controller('scaling-fixture')
class ScalingFixtureController {
  @Get('identity')
  @UseGuards(JwtAuthGuard)
  identity(@Req() req: AuthenticatedRequest) {
    return req.user;
  }
}

describe('independent Nest instances with shared session authority', () => {
  const actorId = 'scaling-fixture-user',
    sessionId = 'scaling-fixture-session';
  const session = {
    revokedAt: null as Date | null,
    expiresAt: new Date(Date.now() + 3600000),
  };
  let role: 'OWNER' | 'CASHIER' = 'OWNER';
  const sharedAuthority = {
    authSession: {
      findFirst: vi.fn(async ({ where }) => {
        if (
          where.id !== sessionId ||
          where.userId !== actorId ||
          session.revokedAt ||
          session.expiresAt <= where.expiresAt.gt
        )
          return null;
        return {
          ...session,
          user: {
            id: actorId,
            email: 'fixture@example.test',
            createdAt: new Date('2026-01-01'),
            firstName: null,
            lastName: null,
            memberships: [
              {
                id: 'fixture-member',
                shopId: 'fixture-shop',
                role,
                shop: {
                  id: 'fixture-shop',
                  name: 'Fixture',
                  slug: 'fixture',
                  isActive: true,
                  logoUrl: null,
                },
              },
            ],
          },
        };
      }),
    },
  };
  let first: INestApplication, second: INestApplication, accessToken: string;
  async function start() {
    const module = await Test.createTestingModule({
      imports: [AppModule, AuthModule],
      controllers: [ScalingFixtureController],
    })
      .overrideProvider(PrismaService)
      .useValue(sharedAuthority)
      .compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    return app;
  }
  const identity = (app: INestApplication) =>
    request(app.getHttpServer())
      .get('/api/v1/scaling-fixture/identity')
      .set('Authorization', `Bearer ${accessToken}`);
  beforeAll(async () => {
    first = await start();
    second = await start();
    accessToken = (
      await first
        .get(TokensService)
        .issue(actorId, sessionId, session.expiresAt)
    ).accessToken;
  });
  beforeEach(() => {
    session.revokedAt = null;
    role = 'OWNER';
  });
  afterAll(async () => {
    await first?.close();
    await second?.close();
  });

  it('accepts a token issued by one instance on another without sticky sessions', async () => {
    const replies = await Promise.all([identity(first), identity(second)]);
    expect(replies.map((res) => res.status)).toEqual([200, 200]);
    expect(replies.every((res) => res.body.id === actorId)).toBe(true);
    expect(first.get(ApiObservabilityService).instanceId).not.toBe(
      second.get(ApiObservabilityService).instanceId,
    );
    expect(replies[0].headers['x-request-id']).not.toBe(
      replies[1].headers['x-request-id'],
    );
  });
  it('sees changed memberships and session revocation on both instances', async () => {
    role = 'CASHIER';
    for (const app of [first, second])
      expect((await identity(app)).body.memberships[0].role).toBe('CASHIER');
    session.revokedAt = new Date();
    for (const app of [first, second])
      expect((await identity(app)).status).toBe(401);
  });
  it('retains session validity after replacing an instance with the same shared configuration', async () => {
    await second.close();
    second = await start();
    const reply = await identity(second)
      .set('X-Shop-Id', 'another-shop')
      .set('X-User-Id', 'another-user');
    expect(reply.status).toBe(200);
    expect(reply.body.id).toBe(actorId);
    expect(reply.body.memberships[0].shopId).toBe('fixture-shop');
  });
});
