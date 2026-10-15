import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { NewOrderEventsService } from '../src/modules/orders/new-order-events.service.js';

describe('Public menu availability stream', () => {
  let app: INestApplication<App>;
  const findShop = vi.fn();
  const relay = vi.fn<NewOrderEventsService['relay']>(async (...args) => {
    await args[3]();
    args[4].end();
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ shop: { findFirst: findShop } })
      .overrideProvider(NewOrderEventsService)
      .useValue({ relay })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    findShop.mockResolvedValue({ id: 'shop-a' });
  });
  it('allows anonymous menu invalidations and binds the topic to the live resolved shop', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/menu/cafe/availability-events')
      .expect(200);
    expect(relay).toHaveBeenCalledWith(
      'menu:availability:shop-a:cafe',
      'product_sold_out',
      { shopSlug: 'cafe' },
      expect.any(Function),
      expect.anything(),
    );
    expect(findShop).toHaveBeenLastCalledWith({
      where: { id: 'shop-a', slug: 'cafe', isActive: true },
      select: { id: true },
    });
    const authorize = relay.mock.calls[0][3];
    findShop.mockResolvedValue(null);
    await expect(authorize()).rejects.toThrow();
  });
  it.each(['missing', 'INVALID'])(
    'rejects unavailable or malformed menu %s before subscribing',
    async (slug) => {
      findShop.mockResolvedValue(null);
      await request(app.getHttpServer())
        .get(`/api/v1/menu/${slug}/availability-events`)
        .expect(404);
      expect(relay).not.toHaveBeenCalled();
    },
  );
});
