import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';

describe('product variants management', () => {
  let app: INestApplication<App>;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const productId = 'a47f6994-a303-4a7b-87b0-2386d5198828';
  const variantId = 'b47f6994-a303-4a7b-87b0-2386d5198828';
  const groupId = 'c47f6994-a303-4a7b-87b0-2386d5198828';
  const foreignId = 'd47f6994-a303-4a7b-87b0-2386d5198828';
  const currentUser = vi.fn(),
    membership = vi.fn(),
    findProduct = vi.fn(),
    findVariant = vi.fn(),
    writeProduct = vi.fn(),
    writeVariant = vi.fn(),
    writeGroup = vi.fn();
  let role: string;
  const dates = {
    createdAt: new Date('2026-10-10T00:00:00Z'),
    updatedAt: new Date('2026-10-10T00:00:00Z'),
  };
  const variant = {
    id: variantId,
    shopId,
    productId,
    optionGroupId: null,
    name: 'Regular',
    priceAdjustment: new Prisma.Decimal('0'),
    isDefault: false,
    isAvailable: true,
    sortOrder: 0,
    ...dates,
  };
  const group = {
    id: groupId,
    shopId,
    productId,
    name: 'Size',
    isRequired: true,
    isAvailable: true,
    sortOrder: 0,
    ...dates,
  };
  const missing = () =>
    new Prisma.PrismaClientKnownRequestError('Not accessible', {
      code: 'P2025',
      clientVersion: 'test',
    });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthService)
      .useValue({ currentUser })
      .overrideProvider(PrismaService)
      .useValue({
        shopMember: { findUnique: membership },
        product: { findFirst: findProduct, update: writeProduct },
        productVariant: { update: writeVariant, findFirst: findVariant },
        productOptionGroup: { update: writeGroup },
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
    vi.resetAllMocks();
    role = 'OWNER';
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
    findProduct.mockImplementation(async ({ where, select }) => {
      if (where.id !== productId || where.shopId !== shopId) return null;
      return select.id
        ? { id: productId, shopId }
        : { variants: [variant], optionGroups: [group] };
    });
    findVariant.mockImplementation(async ({ where }) =>
      where.id === variantId &&
      where.productId === productId &&
      where.shopId === shopId
        ? variant
        : null,
    );
    writeProduct.mockImplementation(async ({ data }) => {
      if (data.optionGroups)
        return { optionGroups: [{ ...group, ...data.optionGroups.create }] };
      return {
        variants: [
          {
            ...variant,
            ...data.variants.create,
            priceAdjustment: new Prisma.Decimal(
              data.variants.create.priceAdjustment,
            ),
            optionGroupId: data.variants.create.optionGroupId ?? null,
            isDefault: data.variants.create.isDefault ?? false,
          },
        ],
      };
    });
    writeVariant.mockImplementation(async ({ where, data }) => {
      if (
        where.id !== variantId ||
        where.productId !== productId ||
        where.shopId !== shopId
      )
        throw missing();
      return {
        ...variant,
        ...Object.fromEntries(
          Object.entries(data).filter(([, value]) => value !== undefined),
        ),
        priceAdjustment: new Prisma.Decimal(
          data.priceAdjustment ?? variant.priceAdjustment,
        ),
      };
    });
    writeGroup.mockImplementation(async ({ where, data }) => {
      if (
        where.id !== groupId ||
        where.productId !== productId ||
        where.shopId !== shopId
      )
        throw missing();
      return {
        ...group,
        ...Object.fromEntries(
          Object.entries(data).filter(([, value]) => value !== undefined),
        ),
      };
    });
  });
  const path = (suffix: string, product = productId) =>
    `/api/v1/shops/${shopId}/products/${product}/${suffix}`;
  const post = (suffix: string, body: object, product = productId) =>
    request(app.getHttpServer())
      .post(path(suffix, product))
      .set('Authorization', 'Bearer valid')
      .send(body);
  const patch = (suffix: string, body: object) =>
    request(app.getHttpServer())
      .patch(path(suffix))
      .set('Authorization', 'Bearer valid')
      .send(body);
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'allows %s to create Regular as the explicit default/base option',
    async (allowed) => {
      role = allowed;
      const response = await post('variants/regular', {
        optionGroupId: groupId,
      }).expect(201);
      expect(response.body.variant).toMatchObject({
        name: 'Regular',
        priceAdjustment: '0.00',
        isDefault: true,
        isAvailable: true,
        optionGroupId: groupId,
        sortOrder: 0,
      });
      expect(response.headers['cache-control']).toBe('no-store');
    },
  );
  it('creates an ungrouped Regular default without changing the product price', async () => {
    const response = await post('variants/regular', {}).expect(201);
    expect(response.body.variant).toMatchObject({
      optionGroupId: null,
      isDefault: true,
      priceAdjustment: '0.00',
    });
    expect(writeProduct.mock.calls[0][0].data).not.toHaveProperty('price');
  });
  it.each(['CASHIER', 'KITCHEN'])(
    'blocks %s from creating Regular',
    async (denied) => {
      role = denied;
      await post('variants/regular', {}).expect(403);
      expect(writeProduct).not.toHaveBeenCalled();
    },
  );
  it.each([
    { priceAdjustment: '5' },
    { name: 'Large' },
    { isDefault: false },
    { shopId: foreignId },
    { optionGroupId: 'invalid' },
    { sortOrder: -1 },
  ])('rejects Regular overrides and invalid fields %j', async (body) => {
    await post('variants/regular', body).expect(400);
    expect(writeProduct).not.toHaveBeenCalled();
  });
  it('rejects Regular under a foreign product', async () => {
    await post('variants/regular', {}, foreignId).expect(404);
    expect(writeProduct).not.toHaveBeenCalled();
  });
  it('rejects a paid default on create and edit', async () => {
    const created = await post('variants', {
      name: 'Regular',
      priceAdjustment: '1',
      isDefault: true,
    }).expect(400);
    expect(created.body.code).toBe('DEFAULT_VARIANT_MUST_USE_BASE_PRICE');
    await patch(`variants/${variantId}`, {
      isDefault: true,
      priceAdjustment: '1',
    }).expect(400);
    expect(writeProduct).not.toHaveBeenCalled();
    expect(writeVariant).not.toHaveBeenCalled();
  });
  it('requires zero when promoting an existing paid variant to default', async () => {
    findVariant.mockResolvedValue({
      ...variant,
      priceAdjustment: new Prisma.Decimal('5'),
    });
    await patch(`variants/${variantId}`, { isDefault: true }).expect(400);
    expect(
      (
        await patch(`variants/${variantId}`, {
          isDefault: true,
          priceAdjustment: '0',
        }).expect(200)
      ).body.variant,
    ).toMatchObject({ isDefault: true, priceAdjustment: '0.00' });
  });
  it('protects the base price on partial edits and permits explicitly removing default status', async () => {
    findVariant.mockResolvedValue({ ...variant, isDefault: true });
    await patch(`variants/${variantId}`, { priceAdjustment: '5' }).expect(400);
    expect(writeVariant).not.toHaveBeenCalled();
    expect(
      (
        await patch(`variants/${variantId}`, {
          isDefault: false,
          priceAdjustment: '5',
        }).expect(200)
      ).body.variant,
    ).toMatchObject({ isDefault: false, priceAdjustment: '5.00' });
  });
  it.each([null, 'true', 1])(
    'rejects invalid isDefault %s',
    async (isDefault) => {
      await post('variants', {
        name: 'Regular',
        priceAdjustment: '0',
        isDefault,
      }).expect(400);
      await patch(`variants/${variantId}`, { isDefault }).expect(400);
    },
  );
  it('returns a conflict when a Regular/default choice already exists', async () => {
    writeProduct.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate default', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    expect((await post('variants/regular', {}).expect(409)).body.code).toBe(
      'VARIANT_CHOICE_CONFLICT',
    );
  });
  it('maps a database default-price constraint race to validation feedback', async () => {
    writeVariant.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Constraint', {
        code: 'P2004',
        clientVersion: 'test',
        meta: { constraint: 'product_variants_default_base_price' },
      }),
    );
    expect(
      (
        await patch(`variants/${variantId}`, { priceAdjustment: '1' }).expect(
          400,
        )
      ).body.code,
    ).toBe('DEFAULT_VARIANT_MUST_USE_BASE_PRICE');
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'allows %s to create zero-cost and grouped variants',
    async (allowed) => {
      role = allowed;
      const free = await post('variants', {
        name: ' Regular ',
        priceAdjustment: '0',
      }).expect(201);
      expect(free.body.variant.priceAdjustment).toBe('0.00');
      expect(free.body.variant.name).toBe('Regular');
      expect(free.body.variant.optionGroupId).toBeNull();
      const paid = await post('variants', {
        name: 'Large',
        priceAdjustment: '30.1',
        optionGroupId: groupId,
      }).expect(201);
      expect(paid.body.variant.priceAdjustment).toBe('30.10');
      expect(paid.headers['cache-control']).toBe('no-store');
      const where = writeProduct.mock.calls[1][0].where;
      expect(where).toMatchObject({
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
    },
  );
  it('lists groups and variants with exact serialized surcharges', async () => {
    const response = await request(app.getHttpServer())
      .get(path('variants'))
      .set('Authorization', 'Bearer valid')
      .expect(200);
    expect(response.body.variants[0].priceAdjustment).toBe('0.00');
    expect(response.body.optionGroups[0].isRequired).toBe(true);
    expect(findProduct.mock.calls.at(-1)?.[0]).toMatchObject({
      where: { id: productId, shopId, isArchived: false },
      select: {
        variants: { where: { shopId, productId } },
        optionGroups: { where: { shopId, productId } },
      },
    });
  });
  it('creates optional groups and disables variants and groups', async () => {
    const response = await post('option-groups', {
      name: 'Temperature',
      isRequired: false,
    }).expect(201);
    expect(response.body.optionGroup.isRequired).toBe(false);
    expect(
      (await patch(`variants/${variantId}`, { isAvailable: false }).expect(200))
        .body.variant.isAvailable,
    ).toBe(false);
    expect(
      (
        await patch(`option-groups/${groupId}`, { isAvailable: false }).expect(
          200,
        )
      ).body.optionGroup.isAvailable,
    ).toBe(false);
  });
  it('updates surcharge and can move a variant into or out of a group', async () => {
    expect(
      (
        await patch(`variants/${variantId}`, {
          priceAdjustment: '0.01',
          optionGroupId: groupId,
        }).expect(200)
      ).body.variant,
    ).toMatchObject({ priceAdjustment: '0.01', optionGroupId: groupId });
    expect(
      (
        await patch(`variants/${variantId}`, { optionGroupId: null }).expect(
          200,
        )
      ).body.variant.optionGroupId,
    ).toBeNull();
    expect(writeVariant.mock.calls[0][0].where).toMatchObject({
      id: variantId,
      shopId,
      productId,
      product: {
        id: productId,
        shopId,
        isArchived: false,
        shop: { id: shopId, isActive: true },
      },
    });
  });
  it.each(['CASHIER', 'KITCHEN'])(
    'blocks %s from variant management',
    async (denied) => {
      role = denied;
      await post('variants', { name: 'Large', priceAdjustment: '30' }).expect(
        403,
      );
      await request(app.getHttpServer())
        .get(path('variants'))
        .set('Authorization', 'Bearer valid')
        .expect(403);
      await patch(`variants/${variantId}`, { isAvailable: false }).expect(403);
      expect(writeProduct).not.toHaveBeenCalled();
      expect(writeVariant).not.toHaveBeenCalled();
    },
  );
  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post(path('variants'))
      .send({ name: 'Large', priceAdjustment: '30' })
      .expect(401);
    expect(writeProduct).not.toHaveBeenCalled();
  });
  it('rejects mixed product URLs even when the actor has membership', async () => {
    await post(
      'variants',
      { name: 'Large', priceAdjustment: '30' },
      foreignId,
    ).expect(404);
    expect(writeProduct).not.toHaveBeenCalled();
  });
  it('rejects foreign variants and groups with the same generic response', async () => {
    expect(
      (await patch(`variants/${foreignId}`, { name: 'Large' }).expect(404)).body
        .code,
    ).toBe('RESOURCE_NOT_ACCESSIBLE');
    expect(
      (await patch(`option-groups/${foreignId}`, { name: 'Size' }).expect(404))
        .body.code,
    ).toBe('RESOURCE_NOT_ACCESSIBLE');
  });
  it.each([
    '-1',
    'NaN',
    'Infinity',
    '1e2',
    '0.001',
    '100000000',
    '01',
    ' 30 ',
    '',
    null,
    30,
  ])(
    'rejects invalid surcharge %s on create and edit',
    async (priceAdjustment) => {
      await post('variants', { name: 'Large', priceAdjustment }).expect(400);
      await patch(`variants/${variantId}`, { priceAdjustment }).expect(400);
      expect(writeProduct).not.toHaveBeenCalled();
      expect(writeVariant).not.toHaveBeenCalled();
    },
  );
  it.each([
    { name: '' },
    { name: ' '.repeat(3) },
    { name: 'x'.repeat(81) },
    { name: null },
    { sortOrder: -1 },
    { sortOrder: 1000001 },
    { sortOrder: 0.5 },
    { isAvailable: null },
    { optionGroupId: 'bad' },
    { shopId: foreignId },
    { productId: foreignId },
  ])('rejects invalid variant fields %j', async (fields) => {
    await post('variants', {
      name: 'Large',
      priceAdjustment: '30',
      ...fields,
    }).expect(400);
    expect(writeProduct).not.toHaveBeenCalled();
  });
  it.each([{}, { name: null }, { isRequired: null }, { sortOrder: -1 }])(
    'rejects invalid group updates %j',
    async (body) => {
      await patch(`option-groups/${groupId}`, body).expect(400);
      expect(writeGroup).not.toHaveBeenCalled();
    },
  );
  it('rejects missing fields and empty variant edits', async () => {
    await post('variants', { name: 'Large' }).expect(400);
    await post('option-groups', {}).expect(400);
    await patch(`variants/${variantId}`, {}).expect(400);
    await patch('variants/not-a-uuid', { name: 'Large' }).expect(400);
  });
  it('returns conflicts for duplicate choice names', async () => {
    writeProduct.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    expect(
      (
        await post('variants', { name: 'Large', priceAdjustment: '30' }).expect(
          409,
        )
      ).body.code,
    ).toBe('VARIANT_CHOICE_CONFLICT');
  });
  it('maps incompatible group links and revoked access to generic not-found', async () => {
    writeProduct.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );
    await post('variants', {
      name: 'Large',
      priceAdjustment: '30',
      optionGroupId: foreignId,
    }).expect(404);
    writeVariant.mockRejectedValue(missing());
    await patch(`variants/${variantId}`, { name: 'Large' }).expect(404);
  });
});
