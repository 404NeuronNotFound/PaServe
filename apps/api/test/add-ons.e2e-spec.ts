import { resetRateLimits } from './rate-limit-test-utils.js';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';

describe('add-on management and product selection', () => {
  let app: INestApplication<App>;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const otherShop = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const productId = 'a47f6994-a303-4a7b-87b0-2386d5198828';
  const shotId = 'b47f6994-a303-4a7b-87b0-2386d5198828';
  const oatId = 'c47f6994-a303-4a7b-87b0-2386d5198828';
  const cheeseId = 'd47f6994-a303-4a7b-87b0-2386d5198828';
  const foreignId = 'e47f6994-a303-4a7b-87b0-2386d5198828';
  const currentUser = vi.fn(),
    membership = vi.fn(),
    findShop = vi.fn(),
    writeShop = vi.fn(),
    findProduct = vi.fn(),
    writeProduct = vi.fn(),
    findAddOn = vi.fn(),
    writeAddOn = vi.fn(),
    deleteAddOn = vi.fn(),
    remove = vi.fn();
  let role: string,
    status: 'AVAILABLE' | 'SOLD_OUT' | 'HIDDEN',
    archived: boolean,
    categoryVisible: boolean,
    shopActive: boolean;
  let rows: Array<{
    id: string;
    shopId: string;
    name: string;
    priceAdjustment: Prisma.Decimal;
    isAvailable: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
  let assigned: Set<string>;
  const missing = () =>
    new Prisma.PrismaClientKnownRequestError('Missing', {
      code: 'P2025',
      clientVersion: 'test',
    });
  const duplicate = () =>
    new Prisma.PrismaClientKnownRequestError('Duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthService)
      .useValue({ currentUser })
      .overrideProvider(PrismaService)
      .useValue({
        shopMember: { findUnique: membership },
        shop: { findFirst: findShop, update: writeShop },
        product: { findFirst: findProduct, update: writeProduct },
        addOn: {
          findFirst: findAddOn,
          update: writeAddOn,
          delete: deleteAddOn,
        },
        productAddOn: { deleteMany: remove },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    resetRateLimits(app);
    vi.resetAllMocks();
    role = 'OWNER';
    status = 'AVAILABLE';
    archived = false;
    categoryVisible = true;
    shopActive = true;
    assigned = new Set([shotId, oatId]);
    deleteAddOn.mockImplementation(async ({ where }) => {
      const index = rows.findIndex(
        (row) => row.id === where.id && row.shopId === where.shopId,
      );
      if (index < 0) throw missing();
      assigned.delete(where.id);
      return rows.splice(index, 1)[0];
    });
    currentUser.mockResolvedValue({ id: userId });
    membership.mockImplementation(async ({ where }) => ({
      id: 'member',
      shopId: where.userId_shopId.shopId,
      role,
      user: { isActive: true },
      shop: {
        id: where.userId_shopId.shopId,
        name: 'Cafe',
        slug: 'cafe',
        isActive: true,
      },
    }));
    rows = [shotId, oatId, cheeseId, foreignId].map((id, index) => ({
      id,
      shopId: id === foreignId ? otherShop : shopId,
      name: ['Extra Shot', 'Oat Milk', 'Cheese', 'Foreign'][index],
      priceAdjustment: new Prisma.Decimal(['30.10', '25.20', '0', '1'][index]),
      isAvailable: true,
      sortOrder: index,
      createdAt: new Date('2026-10-10T00:00:00Z'),
      updatedAt: new Date('2026-10-10T00:00:00Z'),
    }));
    findShop.mockImplementation(async ({ where, select }) => {
      if (!shopActive) return null;
      if (select.id) return where.slug === 'cafe' ? { id: shopId } : null;
      return where.id === shopId
        ? {
            addOns: rows
              .filter((row) => row.shopId === shopId)
              .map((row) => ({ ...row, products: [] })),
          }
        : null;
    });
    writeShop.mockImplementation(async ({ data }) => ({
      addOns: [
        {
          ...rows[0],
          ...Object.fromEntries(
            Object.entries(data.addOns.create).filter(
              ([, value]) => value !== undefined,
            ),
          ),
          priceAdjustment: new Prisma.Decimal(
            data.addOns.create.priceAdjustment,
          ),
        },
      ],
    }));
    findAddOn.mockImplementation(
      async ({ where }) =>
        rows.find(
          (row) => row.id === where.id && row.shopId === where.shopId,
        ) ?? null,
    );
    writeAddOn.mockImplementation(async ({ where, data }) => {
      const row = rows.find(
        (row) => row.id === where.id && row.shopId === where.shopId,
      );
      if (!row) throw missing();
      Object.assign(
        row,
        Object.fromEntries(
          Object.entries(data).filter(([, value]) => value !== undefined),
        ),
      );
      row.priceAdjustment = new Prisma.Decimal(row.priceAdjustment);
      return row;
    });
    findProduct.mockImplementation(async ({ where, select }) => {
      if (where.id !== productId || where.shopId !== shopId) return null;
      if (select.id && !select.price) return { id: productId, shopId };
      if (
        archived ||
        (where.status &&
          (status === 'HIDDEN' || !categoryVisible || !shopActive))
      )
        return null;
      const onlyAvailable = Boolean(select.addOns.where.addOn?.isAvailable);
      return {
        id: productId,
        price: new Prisma.Decimal('120.00'),
        status,
        addOns: rows
          .filter(
            (row) =>
              row.shopId === shopId &&
              assigned.has(row.id) &&
              (!onlyAvailable || row.isAvailable),
          )
          .map((addOn) => ({ shopId, productId, addOnId: addOn.id, addOn })),
      };
    });
    writeProduct.mockImplementation(async ({ where, data }) => {
      if (where.id !== productId || where.shopId !== shopId || archived)
        throw missing();
      const addOnId = data.addOns.create.addOnId;
      if (assigned.has(addOnId)) throw duplicate();
      const addOn = rows.find(
        (row) => row.id === addOnId && row.shopId === shopId,
      );
      if (!addOn) throw missing();
      assigned.add(addOnId);
      return { addOns: [{ shopId, productId, addOnId, addOn }] };
    });
    remove.mockImplementation(async ({ where }) => ({
      count:
        where.shopId === shopId &&
        where.productId === productId &&
        !archived &&
        assigned.delete(where.addOnId)
          ? 1
          : 0,
    }));
  });
  const root = `/api/v1/shops/${shopId}/add-ons`;
  const productPath = `/api/v1/shops/${shopId}/products/${productId}/add-ons`;
  const publicPath = `/api/v1/menu/cafe/products/${productId}/add-ons`;
  const create = (body: object) =>
    request(app.getHttpServer())
      .post(root)
      .set('Authorization', 'Bearer valid')
      .send(body);
  const assign = (id: string) =>
    request(app.getHttpServer())
      .post(productPath)
      .set('Authorization', 'Bearer valid')
      .send({ addOnId: id });
  const quote = (body: unknown = { addOnIds: [shotId, oatId] }) =>
    request(app.getHttpServer()).post(`${publicPath}/quote`).send(body);
  const destroy = (id = shotId) =>
    request(app.getHttpServer())
      .delete(`${root}/${id}`)
      .set('Authorization', 'Bearer valid');
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'allows %s to delete a shared add-on with live shop scope',
    async (authorizedRole) => {
      role = authorizedRole;
      const result = await destroy().expect(204);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(deleteAddOn).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: shotId,
          shopId,
          shop: expect.objectContaining({ id: shopId, isActive: true }),
        }),
      });
      expect(assigned.has(shotId)).toBe(false);
      await quote({ addOnIds: [shotId] }).expect(400);
      const allowed = await request(app.getHttpServer())
        .get(publicPath)
        .expect(200);
      expect(
        allowed.body.addOns.map((item: { id: string }) => item.id),
      ).not.toContain(shotId);
    },
  );
  it.each(['CASHIER', 'KITCHEN'])(
    'denies %s shared add-on deletion',
    async (restrictedRole) => {
      role = restrictedRole;
      await destroy().expect(403);
      expect(deleteAddOn).not.toHaveBeenCalled();
    },
  );
  it('denies unauthenticated shared deletion', async () => {
    await request(app.getHttpServer()).delete(`${root}/${shotId}`).expect(401);
    expect(deleteAddOn).not.toHaveBeenCalled();
  });
  it('rejects foreign, missing and malformed add-on identifiers', async () => {
    await destroy(foreignId).expect(404);
    await destroy(randomUUID()).expect(404);
    await destroy('invalid').expect(400);
    expect(deleteAddOn).not.toHaveBeenCalled();
  });
  it('reports lost access or missing resources at the conditional deletion write', async () => {
    deleteAddOn.mockRejectedValue(missing());
    await destroy().expect(404);
    expect(assigned.has(shotId)).toBe(true);
  });
  it('allows deleting a disabled or unassigned add-on', async () => {
    rows.find((item) => item.id === cheeseId)!.isAvailable = false;
    await destroy(cheeseId).expect(204);
    expect(deleteAddOn).toHaveBeenCalledOnce();
  });
  it.each([
    ['No Onions', '0', '0.00'],
    ['No Whipped Cream', '0.00', '0.00'],
    ['Extra Cheese', '15.5', '15.50'],
    ['Caramel Drizzle', '8.25', '8.25'],
  ])(
    'creates custom modifier %s at %s',
    async (name, priceAdjustment, expected) => {
      const response = await create({ name, priceAdjustment }).expect(201);
      expect(response.body.addOn).toMatchObject({
        name,
        priceAdjustment: expected,
        isAvailable: true,
      });
    },
  );
  it('retains a zero-cost removal in selection and combines it with a paid topping', async () => {
    const update = (id: string, body: object) =>
      request(app.getHttpServer())
        .patch(`${root}/${id}`)
        .set('Authorization', 'Bearer valid')
        .send(body);
    await update(cheeseId, { name: 'No Onions', priceAdjustment: '0' }).expect(
      200,
    );
    await update(shotId, {
      name: 'Extra Cheese',
      priceAdjustment: '15.50',
    }).expect(200);
    await quote({ addOnIds: [cheeseId] }).expect(400);
    await assign(cheeseId).expect(201);
    const free = await quote({ addOnIds: [cheeseId] }).expect(201);
    expect(free.body).toMatchObject({
      addOnTotal: '0.00',
      baseWithAddOnsPrice: '120.00',
      addOns: [{ id: cheeseId, name: 'No Onions', priceAdjustment: '0.00' }],
    });
    const mixed = await quote({ addOnIds: [cheeseId, shotId] }).expect(201);
    expect(mixed.body).toMatchObject({
      addOnTotal: '15.50',
      baseWithAddOnsPrice: '135.50',
      addOns: [
        { id: cheeseId, name: 'No Onions', priceAdjustment: '0.00' },
        { id: shotId, name: 'Extra Cheese', priceAdjustment: '15.50' },
      ],
    });
    await quote({ addOnIds: [cheeseId, cheeseId] }).expect(400);
    await update(cheeseId, { isAvailable: false }).expect(200);
    await quote({ addOnIds: [cheeseId, shotId] }).expect(400);
    await update(cheeseId, { isAvailable: true }).expect(200);
    await request(app.getHttpServer())
      .delete(`${productPath}/${cheeseId}`)
      .set('Authorization', 'Bearer valid')
      .expect(200);
    await quote({ addOnIds: [cheeseId] }).expect(400);
  });
  it('uses current topping prices after editing a free modifier to a paid extra', async () => {
    await assign(cheeseId).expect(201);
    await request(app.getHttpServer())
      .patch(`${root}/${cheeseId}`)
      .set('Authorization', 'Bearer valid')
      .send({ name: 'Extra Cheese', priceAdjustment: '12.75' })
      .expect(200);
    const response = await quote({ addOnIds: [cheeseId] }).expect(201);
    expect(response.body).toMatchObject({
      addOnTotal: '12.75',
      baseWithAddOnsPrice: '132.75',
      addOns: [
        { id: cheeseId, name: 'Extra Cheese', priceAdjustment: '12.75' },
      ],
    });
  });
  it.each([
    ['less ice', 'less ice'],
    ['  no onions  ', 'no onions'],
    ['less ice\r\nno onions', 'less ice\nno onions'],
    ['\u5c11\u51b0\uff0c\u8c22\u8c22', '\u5c11\u51b0\uff0c\u8c22\u8c22'],
    ['<img src=x onerror="alert(1)">', '<img src=x onerror="alert(1)">'],
    ['a'.repeat(300), 'a'.repeat(300)],
    ['\u{1f600}'.repeat(300), '\u{1f600}'.repeat(300)],
  ])(
    'accepts a bounded plain-text customer note %s',
    async (notes, expected) => {
      const response = await quote({ addOnIds: [], notes }).expect(201);
      expect(response.body.notes).toBe(expected);
      expect(response.body.baseWithAddOnsPrice).toBe('120.00');
    },
  );
  it.each(['', ' \r\n\t '])('omits blank customer notes %s', async (notes) => {
    expect(
      (await quote({ addOnIds: [], notes }).expect(201)).body,
    ).not.toHaveProperty('notes');
  });
  it.each([
    'a'.repeat(301),
    '\u{1f600}'.repeat(301),
    null,
    123,
    {},
    [],
    'no\u0000onions',
    'less\u0007ice',
    'hidden\u202etext',
    '\u000b',
    '\u000cless ice',
    'no onions\u000b',
    '\ud800',
    '\udfff',
  ])('rejects invalid customer note %j', async (notes) => {
    await quote({ addOnIds: [], notes }).expect(400);
  });
  it('keeps notes scoped to each quote and preserves add-on eligibility', async () => {
    const first = await quote({ addOnIds: [shotId], notes: 'less ice' }).expect(
      201,
    );
    const second = await quote({
      addOnIds: [shotId],
      notes: 'no sugar',
    }).expect(201);
    expect(first.body.notes).toBe('less ice');
    expect(second.body.notes).toBe('no sugar');
    expect(first.body.baseWithAddOnsPrice).toBe(
      second.body.baseWithAddOnsPrice,
    );
    expect(
      (await quote({ addOnIds: [shotId] }).expect(201)).body,
    ).not.toHaveProperty('notes');
    await quote({ addOnIds: [cheeseId], notes: 'please add cheese' }).expect(
      400,
    );
  });
  const createExtraShot = (body: object) =>
    request(app.getHttpServer())
      .post(`${root}/extra-shot`)
      .set('Authorization', 'Bearer valid')
      .send(body);
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'allows %s to create a priced Extra Shot example',
    async (allowed) => {
      role = allowed;
      const response = await createExtraShot({
        priceAdjustment: '30.1',
      }).expect(201);
      expect(response.body.addOn).toMatchObject({
        name: 'Extra Shot',
        priceAdjustment: '30.10',
        isAvailable: true,
        sortOrder: 0,
      });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(writeShop.mock.calls[0][0].where).toMatchObject({
        id: shopId,
        isActive: true,
        members: { some: { userId, user: { isActive: true } } },
      });
    },
  );
  it.each(['0.01', '99999999.99'])(
    'supports exact Extra Shot price %s and custom ordering',
    async (priceAdjustment) => {
      expect(
        (await createExtraShot({ priceAdjustment, sortOrder: 5 }).expect(201))
          .body.addOn,
      ).toMatchObject({ priceAdjustment, sortOrder: 5 });
    },
  );
  it.each(['0', '0.00'])(
    'rejects an unpriced Extra Shot %s',
    async (priceAdjustment) => {
      expect(
        (await createExtraShot({ priceAdjustment }).expect(400)).body.code,
      ).toBe('EXTRA_SHOT_REQUIRES_SURCHARGE');
      expect(writeShop).not.toHaveBeenCalled();
    },
  );
  it.each(['-1', 'NaN', '1e2', '0.001', '100000000', ' 30 ', 30, null])(
    'rejects invalid Extra Shot surcharge %s',
    async (priceAdjustment) => {
      await createExtraShot({ priceAdjustment }).expect(400);
      expect(writeShop).not.toHaveBeenCalled();
    },
  );
  it.each([
    { name: 'Double Shot' },
    { price: '150' },
    { quantity: 2 },
    { isAvailable: false },
    { shopId: otherShop },
    { productId },
    { sortOrder: -1 },
  ])('rejects Extra Shot overrides and invalid fields %j', async (fields) => {
    await createExtraShot({ priceAdjustment: '30', ...fields }).expect(400);
    expect(writeShop).not.toHaveBeenCalled();
  });
  it.each(['CASHIER', 'KITCHEN'])(
    'blocks %s from creating Extra Shot',
    async (denied) => {
      role = denied;
      await createExtraShot({ priceAdjustment: '30' }).expect(403);
      expect(writeShop).not.toHaveBeenCalled();
    },
  );
  it('requires an Extra Shot price and owner authentication', async () => {
    await createExtraShot({}).expect(400);
    await request(app.getHttpServer())
      .post(`${root}/extra-shot`)
      .send({ priceAdjustment: '30' })
      .expect(401);
  });
  it('returns a conflict without replacing an existing Extra Shot', async () => {
    writeShop.mockRejectedValue(duplicate());
    expect(
      (await createExtraShot({ priceAdjustment: '30' }).expect(409)).body.code,
    ).toBe('ADD_ON_CONFLICT');
  });
  it('includes Extra Shot once in the production quote and rejects it after detachment', async () => {
    const response = await quote({ addOnIds: [shotId] }).expect(201);
    expect(response.body).toMatchObject({
      addOnTotal: '30.10',
      baseWithAddOnsPrice: '150.10',
      addOns: [{ id: shotId, name: 'Extra Shot', priceAdjustment: '30.10' }],
    });
    await quote({ addOnIds: [shotId, shotId] }).expect(400);
    await request(app.getHttpServer())
      .delete(`${productPath}/${shotId}`)
      .set('Authorization', 'Bearer valid')
      .expect(200);
    await quote({ addOnIds: [shotId] }).expect(400);
  });
  const createOatMilk = (body: object) =>
    request(app.getHttpServer())
      .post(`${root}/oat-milk`)
      .set('Authorization', 'Bearer valid')
      .send(body);
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'allows %s to create a priced Oat Milk example',
    async (allowed) => {
      role = allowed;
      const response = await createOatMilk({
        priceAdjustment: '25.2',
      }).expect(201);
      expect(response.body.addOn).toMatchObject({
        name: 'Oat Milk',
        priceAdjustment: '25.20',
        isAvailable: true,
        sortOrder: 0,
      });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(writeShop.mock.calls[0][0].where).toMatchObject({
        id: shopId,
        isActive: true,
        members: { some: { userId, user: { isActive: true } } },
      });
    },
  );
  it.each(['0.01', '99999999.99'])(
    'supports exact Oat Milk price %s and custom ordering',
    async (priceAdjustment) => {
      expect(
        (await createOatMilk({ priceAdjustment, sortOrder: 5 }).expect(201))
          .body.addOn,
      ).toMatchObject({ priceAdjustment, sortOrder: 5 });
    },
  );
  it.each(['0', '0.00'])(
    'rejects an unpriced Oat Milk %s',
    async (priceAdjustment) => {
      expect(
        (await createOatMilk({ priceAdjustment }).expect(400)).body.code,
      ).toBe('OAT_MILK_REQUIRES_SURCHARGE');
      expect(writeShop).not.toHaveBeenCalled();
    },
  );
  it.each(['-1', 'NaN', '1e2', '0.001', '100000000', ' 30 ', 30, null])(
    'rejects invalid Oat Milk surcharge %s',
    async (priceAdjustment) => {
      await createOatMilk({ priceAdjustment }).expect(400);
      expect(writeShop).not.toHaveBeenCalled();
    },
  );
  it.each([
    { name: 'Soy Milk' },
    { price: '150' },
    { quantity: 2 },
    { isAvailable: false },
    { shopId: otherShop },
    { productId },
    { sortOrder: -1 },
  ])('rejects Oat Milk overrides and invalid fields %j', async (fields) => {
    await createOatMilk({ priceAdjustment: '30', ...fields }).expect(400);
    expect(writeShop).not.toHaveBeenCalled();
  });
  it.each(['CASHIER', 'KITCHEN'])(
    'blocks %s from creating Oat Milk',
    async (denied) => {
      role = denied;
      await createOatMilk({ priceAdjustment: '30' }).expect(403);
      expect(writeShop).not.toHaveBeenCalled();
    },
  );
  it('requires an Oat Milk price and owner authentication', async () => {
    await createOatMilk({}).expect(400);
    await request(app.getHttpServer())
      .post(`${root}/oat-milk`)
      .send({ priceAdjustment: '30' })
      .expect(401);
  });
  it('returns a conflict without replacing an existing Oat Milk', async () => {
    writeShop.mockRejectedValue(duplicate());
    expect(
      (await createOatMilk({ priceAdjustment: '30' }).expect(409)).body.code,
    ).toBe('ADD_ON_CONFLICT');
  });
  it('includes Oat Milk once in the production quote and rejects it after detachment', async () => {
    const response = await quote({ addOnIds: [oatId] }).expect(201);
    expect(response.body).toMatchObject({
      addOnTotal: '25.20',
      baseWithAddOnsPrice: '145.20',
      addOns: [{ id: oatId, name: 'Oat Milk', priceAdjustment: '25.20' }],
    });
    await quote({ addOnIds: [oatId, oatId] }).expect(400);
    await request(app.getHttpServer())
      .delete(`${productPath}/${oatId}`)
      .set('Authorization', 'Bearer valid')
      .expect(200);
    await quote({ addOnIds: [oatId] }).expect(400);
  });
  it.each(['Soy Milk', 'Almond Milk', 'Coconut Milk'])(
    'supports custom milk modifier %s through the generic API',
    async (name) => {
      const response = await create({ name, priceAdjustment: '18.75' }).expect(
        201,
      );
      expect(response.body.addOn).toMatchObject({
        name,
        priceAdjustment: '18.75',
      });
    },
  );
  it('rejects disabled Oat Milk and accepts it again when enabled', async () => {
    const update = (isAvailable: boolean) =>
      request(app.getHttpServer())
        .patch(`${root}/${oatId}`)
        .set('Authorization', 'Bearer valid')
        .send({ isAvailable });
    await update(false).expect(200);
    await quote({ addOnIds: [oatId] }).expect(400);
    await update(true).expect(200);
    expect(
      (await quote({ addOnIds: [oatId] }).expect(201)).body.baseWithAddOnsPrice,
    ).toBe('145.20');
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'allows %s to manage reusable add-ons and product eligibility',
    async (allowed) => {
      role = allowed;
      const created = await create({
        name: ' Syrup ',
        priceAdjustment: '10.1',
      }).expect(201);
      expect(created.body.addOn).toMatchObject({
        name: 'Syrup',
        priceAdjustment: '10.10',
      });
      const linked = await assign(cheeseId).expect(201);
      expect(linked.body.addOn.priceAdjustment).toBe('0.00');
      expect(writeProduct.mock.calls[0][0].where).toMatchObject({
        id: productId,
        shopId,
        isArchived: false,
        shop: {
          id: shopId,
          isActive: true,
          members: {
            some: {
              userId,
              user: { isActive: true },
              role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
            },
          },
        },
      });
      expect(created.headers['cache-control']).toBe('no-store');
    },
  );
  it.each(['Extra Shot', 'Oat Milk', 'Cheese', 'Bacon', 'Syrup'])(
    'accepts optional modifier %s',
    async (name) => {
      expect(
        (await create({ name, priceAdjustment: '0' }).expect(201)).body.addOn
          .name,
      ).toBe(name);
    },
  );
  it('lists shop and product add-ons and allows editing', async () => {
    expect(
      (
        await request(app.getHttpServer())
          .get(root)
          .set('Authorization', 'Bearer valid')
          .expect(200)
      ).body.addOns.length,
    ).toBe(3);
    expect(
      (
        await request(app.getHttpServer())
          .get(productPath)
          .set('Authorization', 'Bearer valid')
          .expect(200)
      ).body.addOns.length,
    ).toBe(2);
    const edited = await request(app.getHttpServer())
      .patch(`${root}/${shotId}`)
      .set('Authorization', 'Bearer valid')
      .send({ priceAdjustment: '35', isAvailable: false })
      .expect(200);
    expect(edited.body.addOn).toMatchObject({
      priceAdjustment: '35.00',
      isAvailable: false,
    });
    expect(writeAddOn.mock.calls[0][0].where).toMatchObject({
      id: shotId,
      shopId,
      shop: { id: shopId, isActive: true },
    });
  });
  it('scopes catalog product usage to the shop and keeps it out of public options', async () => {
    const response = await request(app.getHttpServer())
      .get(root)
      .set('Authorization', 'Bearer valid')
      .expect(200);
    expect(response.body.addOns[0].assignedProducts).toEqual([]);
    expect(
      findShop.mock.calls.at(-1)?.[0].select.addOns.include.products.where,
    ).toEqual({ shopId, product: { shopId } });
    const publicResponse = await request(app.getHttpServer())
      .get(publicPath)
      .expect(200);
    expect(publicResponse.body.addOns[0]).not.toHaveProperty(
      'assignedProducts',
    );
  });
  it('calculates exact current server prices for allowed selections', async () => {
    const response = await quote().expect(201);
    expect(response.body).toMatchObject({
      basePrice: '120.00',
      addOnTotal: '55.30',
      baseWithAddOnsPrice: '175.30',
      currency: 'PHP',
    });
    expect(response.body.addOns.map((row) => row.id)).toEqual([shotId, oatId]);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(findProduct.mock.calls.at(-1)?.[0].where).toMatchObject({
      id: productId,
      shopId,
      isArchived: false,
      status: { in: ['AVAILABLE', 'SOLD_OUT'] },
      shop: { id: shopId, slug: 'cafe', isActive: true },
    });
  });
  it('supports no add-ons and exact one-cent values', async () => {
    expect((await quote({ addOnIds: [] }).expect(201)).body).toMatchObject({
      addOnTotal: '0.00',
      baseWithAddOnsPrice: '120.00',
    });
    rows[0].priceAdjustment = new Prisma.Decimal('0.1');
    rows[1].priceAdjustment = new Prisma.Decimal('0.2');
    expect((await quote().expect(201)).body.baseWithAddOnsPrice).toBe('120.30');
  });
  it.each([cheeseId, foreignId, 'f47f6994-a303-4a7b-87b0-2386d5198828'])(
    'rejects unassigned, foreign and missing selection %s identically',
    async (id) => {
      expect((await quote({ addOnIds: [id] }).expect(400)).body.code).toBe(
        'ADD_ON_SELECTION_INVALID',
      );
    },
  );
  it('rejects disabled add-ons and only lists available product assignments publicly', async () => {
    rows[0].isAvailable = false;
    const response = await request(app.getHttpServer())
      .get(publicPath)
      .expect(200);
    expect(response.body.addOns.map((row) => row.id)).toEqual([oatId]);
    expect(response.body.addOns[0]).not.toHaveProperty('shopId');
    await quote().expect(400);
  });
  it('removes eligibility and immediately rejects the detached add-on', async () => {
    await request(app.getHttpServer())
      .delete(`${productPath}/${shotId}`)
      .set('Authorization', 'Bearer valid')
      .expect(200);
    await quote().expect(400);
    expect(remove.mock.calls[0][0].where).toMatchObject({
      shopId,
      productId,
      addOnId: shotId,
      product: { id: productId, shopId, isArchived: false },
    });
  });
  it('shows sold-out product options but rejects quotes', async () => {
    status = 'SOLD_OUT';
    expect(
      (await request(app.getHttpServer()).get(publicPath).expect(200)).body
        .isOrderable,
    ).toBe(false);
    await quote().expect(404);
  });
  it.each(['hidden', 'archived', 'hidden category', 'inactive shop'])(
    'rejects public %s products',
    async (state) => {
      if (state === 'hidden') status = 'HIDDEN';
      if (state === 'archived') archived = true;
      if (state === 'hidden category') categoryVisible = false;
      if (state === 'inactive shop') shopActive = false;
      await quote().expect(404);
    },
  );
  it.each(['CASHIER', 'KITCHEN'])(
    'blocks %s from managing add-ons',
    async (denied) => {
      role = denied;
      await create({ name: 'Syrup', priceAdjustment: '10' }).expect(403);
      await assign(cheeseId).expect(403);
      expect(writeShop).not.toHaveBeenCalled();
      expect(writeProduct).not.toHaveBeenCalled();
    },
  );
  it('requires authentication for management but not public quotes', async () => {
    await request(app.getHttpServer())
      .post(root)
      .send({ name: 'Syrup', priceAdjustment: '10' })
      .expect(401);
    await quote({ addOnIds: [] }).expect(201);
  });
  it('blocks mixed add-on shop URLs and assignments even for a multi-shop owner', async () => {
    await assign(foreignId).expect(404);
    await request(app.getHttpServer())
      .patch(`${root}/${foreignId}`)
      .set('Authorization', 'Bearer valid')
      .send({ name: 'Changed' })
      .expect(404);
    expect(writeProduct).not.toHaveBeenCalled();
    expect(writeAddOn).not.toHaveBeenCalled();
  });
  it('returns conflicts for duplicate assignments and names', async () => {
    await assign(shotId).expect(409);
    writeShop.mockRejectedValue(duplicate());
    await create({ name: 'Extra Shot', priceAdjustment: '10' }).expect(409);
  });
  it.each(['-1', 'NaN', '1e2', '0.001', '100000000', ' 30 ', 30, null])(
    'rejects invalid add-on surcharge %s on create and edit',
    async (priceAdjustment) => {
      await create({ name: 'Syrup', priceAdjustment }).expect(400);
      await request(app.getHttpServer())
        .patch(`${root}/${shotId}`)
        .set('Authorization', 'Bearer valid')
        .send({ priceAdjustment })
        .expect(400);
      expect(writeShop).not.toHaveBeenCalled();
      expect(writeAddOn).not.toHaveBeenCalled();
    },
  );
  it.each([
    { name: '' },
    { name: 'x'.repeat(81) },
    { name: null },
    { isAvailable: null },
    { sortOrder: -1 },
    { shopId: otherShop },
  ])('rejects invalid add-on fields %j', async (fields) => {
    await create({ name: 'Syrup', priceAdjustment: '10', ...fields }).expect(
      400,
    );
  });
  it('rejects empty updates and unknown fields', async () => {
    await create({ name: 'Syrup' }).expect(400);
    await request(app.getHttpServer())
      .patch(`${root}/${shotId}`)
      .set('Authorization', 'Bearer valid')
      .send({})
      .expect(400);
    await create({
      name: 'Syrup',
      priceAdjustment: '10',
      shopId: otherShop,
    }).expect(400);
    await quote({ addOnIds: [], price: '0' }).expect(400);
  });
  it.each(['\ud800', '\udfff'])(
    'rejects malformed Unicode modifier name %j before storage',
    async (name) => {
      await create({ name, priceAdjustment: '0' }).expect(400);
      await request(app.getHttpServer())
        .patch(`${root}/${shotId}`)
        .set('Authorization', 'Bearer valid')
        .send({ name })
        .expect(400);
      expect(writeShop).not.toHaveBeenCalled();
      expect(writeAddOn).not.toHaveBeenCalled();
    },
  );
  it('accepts valid Unicode modifier names at the character limit', async () => {
    const name = '\u{1f600}'.repeat(80);
    expect(
      (await create({ name, priceAdjustment: '0' }).expect(201)).body.addOn
        .name,
    ).toBe(name);
  });
  it.each([
    {},
    { addOnIds: null },
    { addOnIds: 'bad' },
    { addOnIds: ['bad'] },
    { addOnIds: [shotId, shotId] },
    { addOnIds: Array.from({ length: 51 }, () => randomUUID()) },
  ])('rejects invalid selections %j', async (body) => {
    await quote(body).expect(400);
  });
  it('rejects invalid assignment and route identifiers', async () => {
    await assign('bad').expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/menu/cafe/products/bad/add-ons')
      .expect(400);
  });
  it('maps live access changes and database foreign keys to generic not-found', async () => {
    writeProduct.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );
    await assign(cheeseId).expect(404);
    writeAddOn.mockRejectedValue(missing());
    await request(app.getHttpServer())
      .patch(`${root}/${shotId}`)
      .set('Authorization', 'Bearer valid')
      .send({ name: 'Changed' })
      .expect(404);
  });
});
