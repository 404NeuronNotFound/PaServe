import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { invalidSession } from '../src/modules/auth/tokens.service.js';
import { Prisma } from '../src/generated/prisma/client.js';

describe('POST /api/v1/shops', () => {
  let app: INestApplication<App>;
  const create = vi.fn();
  const currentUser = vi.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ shop: { create } })
      .overrideProvider(AuthService)
      .useValue({ currentUser })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    currentUser.mockResolvedValue({ id: 'signed-in-user' });
    create.mockResolvedValue({
      id: 'shop-id',
      name: 'Café North',
      slug: 'cafe-north',
      description: 'Coffee and pastries',
      isActive: true,
      createdAt: new Date('2026-10-09T00:00:00Z'),
      members: [{ id: 'member-id', shopId: 'shop-id', role: 'OWNER' }],
    });
  });
  it('creates a shop and OWNER in one nested write using the authenticated identity', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/shops')
      .set('Authorization', 'Bearer valid-token')
      .send({ name: ' Café North ', description: ' Coffee and pastries ' })
      .expect(201);
    expect(currentUser).toHaveBeenCalledWith('valid-token');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Café North',
          slug: 'cafe-north',
          description: 'Coffee and pastries',
          members: { create: { userId: 'signed-in-user', role: 'OWNER' } },
        },
      }),
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      shop: {
        id: 'shop-id',
        name: 'Café North',
        slug: 'cafe-north',
        description: 'Coffee and pastries',
        isActive: true,
        createdAt: '2026-10-09T00:00:00.000Z',
      },
      membership: {
        id: 'member-id',
        shopId: 'shop-id',
        role: 'OWNER',
        shop: {
          id: 'shop-id',
          name: 'Café North',
          slug: 'cafe-north',
          isActive: true,
        },
      },
    });
  });
  it('allows an omitted description', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/shops')
      .set('Authorization', 'Bearer valid-token')
      .send({ name: 'Café North' })
      .expect(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description: null }),
      }),
    );
  });
  it('resolves collisions from simultaneous requests with the same normalized name', async () => {
    const slugs = new Set<string>();
    create.mockImplementation(
      ({
        data,
      }: {
        data: {
          name: string;
          slug: string;
          description: string | null;
          members: { create: { userId: string; role: string } };
        };
      }) => {
        if (slugs.has(data.slug))
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
            code: 'P2002',
            clientVersion: '7.10.0',
            meta: {
              driverAdapterError: {
                cause: { constraint: { index: 'shops_slug_key' } },
              },
            },
          });
        slugs.add(data.slug);
        const id = `shop-${slugs.size}`;
        return Promise.resolve({
          id,
          name: data.name,
          slug: data.slug,
          description: data.description,
          isActive: true,
          createdAt: new Date(),
          members: [
            {
              id: `member-${slugs.size}`,
              shopId: id,
              role: data.members.create.role,
            },
          ],
        });
      },
    );
    const responses = await Promise.all(
      ['Café North', 'CAFE NORTH', 'Cafe North', 'Café North'].map((name) =>
        request(app.getHttpServer())
          .post('/api/v1/shops')
          .set('Authorization', 'Bearer valid-token')
          .send({ name })
          .expect(201),
      ),
    );
    const returnedSlugs = responses.map(
      (response) => response.body.shop.slug as string,
    );
    expect(new Set(returnedSlugs).size).toBe(4);
    expect(returnedSlugs).toContain('cafe-north');
    for (const response of responses) {
      expect(response.body.shop.slug).toMatch(/^cafe-north(?:-[a-f0-9]{8})?$/);
      expect(response.body.membership.shop.slug).toBe(response.body.shop.slug);
      expect(response.body.membership.role).toBe('OWNER');
    }
  });
  it('returns a recoverable conflict when all slug attempts collide', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '7.10.0',
        meta: { target: ['slug'] },
      }),
    );
    const response = await request(app.getHttpServer())
      .post('/api/v1/shops')
      .set('Authorization', 'Bearer valid-token')
      .send({ name: 'Café North' })
      .expect(409);
    expect(response.body.code).toBe('SHOP_SLUG_UNAVAILABLE');
    expect(create).toHaveBeenCalledTimes(5);
  });
  it.each([
    {},
    { name: '   ' },
    { name: 42 },
    { name: 'x'.repeat(121) },
    { name: 'Shop', description: 'x'.repeat(1001) },
    { name: 'Shop', description: null },
    { name: 'Shop', description: {} },
    { name: 'Shop', role: 'ADMIN' },
    { name: 'Shop', userId: 'victim' },
    { name: 'Shop', slug: 'injected' },
    { name: 'Shop', isActive: false },
  ])('rejects invalid or injected fields (%j)', async (body) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/shops')
      .set('Authorization', 'Bearer valid-token')
      .send(body)
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects an unauthenticated request before writes', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/shops')
      .send({ name: 'Shop' })
      .expect(401);
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects expired or revoked sessions before writes', async () => {
    currentUser.mockRejectedValue(invalidSession());
    await request(app.getHttpServer())
      .post('/api/v1/shops')
      .set('Authorization', 'Bearer revoked')
      .send({ name: 'Shop' })
      .expect(401);
    expect(create).not.toHaveBeenCalled();
  });
  it('keeps database failure details private', async () => {
    create.mockRejectedValue(new Error('Sensitive database error'));
    const response = await request(app.getHttpServer())
      .post('/api/v1/shops')
      .set('Authorization', 'Bearer valid-token')
      .send({ name: 'Shop' })
      .expect(500);
    expect(response.body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(response.text).not.toContain('Sensitive');
  });
});
