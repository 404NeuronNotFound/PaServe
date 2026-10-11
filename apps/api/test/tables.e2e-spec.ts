import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';

describe('tenant-scoped table creation', () => {
  let app: INestApplication<App>;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const other = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const findUnique = vi.fn(),
    update = vi.fn(),
    findFirst = vi.fn(),
    currentUser = vi.fn();
  let role: string, active: boolean;
  const table = {
    id: 'table-id',
    shopId,
    number: '12',
    code: 'T12',

    isActive: true,
    createdAt: new Date('2026-10-09T00:00:00Z'),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthService)
      .useValue({ currentUser })
      .overrideProvider(PrismaService)
      .useValue({ shopMember: { findUnique }, shop: { update, findFirst } })
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
    role = 'OWNER';
    active = true;
    currentUser.mockResolvedValue({ id: userId });
    findUnique.mockImplementation(async ({ where }) =>
      where.userId_shopId.shopId === shopId
        ? {
            id: 'member',
            shopId,
            role,
            user: { isActive: active },
            shop: { id: shopId, name: 'Cafe', slug: 'cafe', isActive: true },
          }
        : null,
    );
    update.mockResolvedValue({ tables: [table] });
    findFirst.mockResolvedValue({ tables: [table] });
  });
  const post = (body: unknown = { number: '12' }, target = shopId) =>
    request(app.getHttpServer())
      .post(`/api/v1/shops/${target}/tables`)
      .set('Authorization', 'Bearer valid')
      .send(body);
  it.each(['OWNER', 'ADMIN'])(
    'allows %s and creates only in the validated tenant',
    async (current) => {
      role = current;
      const response = await post({ number: '12' }).expect(201);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.table).toMatchObject({
        shopId,
        number: '12',
        code: 'T12',
        isActive: true,
      });
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: shopId,
            isActive: true,
            members: {
              some: {
                userId,
                role: { in: ['OWNER', 'ADMIN'] },
                user: { isActive: true },
              },
            },
          },
          data: { tables: { create: { number: '12', code: 'T12' } } },
          select: expect.objectContaining({
            tables: expect.objectContaining({
              where: { shopId, number: '12' },
            }),
          }),
        }),
      );
    },
  );
  it.each(['MANAGER', 'CASHIER', 'KITCHEN'])(
    'denies %s before queries or writes',
    async (current) => {
      role = current;
      await post().expect(403);
      await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/tables`)
        .set('Authorization', 'Bearer valid')
        .expect(403);
      expect(update).not.toHaveBeenCalled();
      expect(findFirst).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { number: 0 },
    { number: -1 },
    { number: 10000 },
    { number: 1.5 },
    { number: null },
    { number: '' },
    { number: '   ' },
    { number: 'x'.repeat(41) },
    { number: 'Patio\n4' },
    { number: 'A\u00003' },
    { number: '\tA3' },
    { number: 'A\u202e3' },
    { number: true },
    { number: {} },
    { number: '12', shopId: other },
    { number: '12', role: 'OWNER' },
    { number: '12', code: 'CUSTOM' },
    { number: '12', isActive: false },
  ])('validates and rejects privileged fields (%j)', async (body) => {
    const response = await post(body).expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(update).not.toHaveBeenCalled();
  });
  it.each(['12', 'A3', 'Patio 4', '012', '露台 4', 'x'.repeat(40)])(
    'stores and returns the human-facing label %s',
    async (number) => {
      update.mockImplementation(async ({ data }) => ({
        tables: [{ ...table, ...data.tables.create }],
      }));
      const response = await post({ number }).expect(201);
      expect(response.body.table.number).toBe(number);
      const saved = update.mock.calls[0][0].data.tables.create;
      expect(saved.number).toBe(number);
      expect(saved.code).toMatch(/^[A-Za-z0-9-]+$/);
      if (/^\d+$/.test(number)) expect(saved.code).toBe(`T${number}`);
      else expect(saved.code).not.toContain(number);
    },
  );
  it('normalizes spaces while preserving the displayed label', async () => {
    update.mockImplementation(async ({ data }) => ({
      tables: [{ ...table, ...data.tables.create }],
    }));
    const response = await post({ number: '  Patio   4  ' }).expect(201);
    expect(response.body.table.number).toBe('Patio 4');
    expect(update.mock.calls[0][0].select.tables.where.number).toBe('Patio 4');
  });
  it('accepts legacy integer input and returns it as a string', async () => {
    await post({ number: 12 }).expect(201);
    expect(update.mock.calls[0][0].data.tables.create).toEqual({
      number: '12',
      code: 'T12',
    });
  });
  it('lists labels in natural order', async () => {
    findFirst.mockResolvedValue({
      tables: ['Patio 4', '12', 'A10', '2', 'A3'].map((number, id) => ({
        ...table,
        id: String(id),
        number,
      })),
    });
    const response = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/tables`)
      .set('Authorization', 'Bearer valid')
      .expect(200);
    expect(
      response.body.tables.map((item: { number: string }) => item.number),
    ).toEqual(['2', '12', 'A3', 'A10', 'Patio 4']);
  });
  it('rejects another shop URL regardless of forged hints', async () => {
    await post({ number: '12' }, other)
      .query({ shopId })
      .set('X-Shop-Id', shopId)
      .expect(404);
    expect(update).not.toHaveBeenCalled();
  });
  it('denies malformed shop IDs and guests', async () => {
    await post({ number: '12' }, 'bad-id').expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/tables`)
      .send({ number: '12' })
      .expect(401);
    expect(update).not.toHaveBeenCalled();
  });
  it('denies inactive users', async () => {
    active = false;
    await post().expect(404);
    expect(update).not.toHaveBeenCalled();
  });
  it('returns a recoverable duplicate conflict', async () => {
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const response = await post().expect(409);
    expect(response.body.code).toBe('TABLE_ALREADY_EXISTS');
    expect(response.body.fieldErrors.number).toBeDefined();
  });
  it('denies access lost at write time', async () => {
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('lost', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );
    await post().expect(403);
  });
  it('lists only the validated shop and denies access lost during the read', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/tables`)
      .set('Authorization', 'Bearer valid')
      .expect(200);
    expect(response.body.tables).toHaveLength(1);
    expect(findFirst.mock.calls[0][0].select.tables.where).toEqual({
      shopId,
    });
    findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/tables`)
      .set('Authorization', 'Bearer valid')
      .expect(403);
  });
});
