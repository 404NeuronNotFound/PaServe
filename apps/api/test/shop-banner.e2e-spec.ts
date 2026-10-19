import { resetRateLimits } from './rate-limit-test-utils.js';
import { Test } from '@nestjs/testing';
import {
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import sharp from 'sharp';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { ShopBannerStorage } from '../src/modules/shops/shop-banner.storage.js';

describe('shop banner upload', () => {
  let app: INestApplication<App>;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const otherShopId = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const findMembership = vi.fn(),
    findShop = vi.fn(),
    update = vi.fn();
  const currentUser = vi.fn();
  const storage = { upload: vi.fn(), remove: vi.fn(), removePrevious: vi.fn() };
  let role = 'OWNER';
  let image: Buffer;
  const uploaded = {
    bannerUrl: `https://example.com/shops/${shopId}/branding/banner/new.webp`,
    storagePath: `shops/${shopId}/branding/banner/new.webp`,
  };
  const shop = {
    id: shopId,
    name: 'Cafe',
    slug: 'cafe',
    isActive: true,
    createdAt: new Date(),
    bannerUrl: 'https://example.com/old.webp',
    logoUrl: 'https://example.com/unchanged-logo.webp',
  };
  beforeAll(async () => {
    image = await sharp({
      create: {
        width: 20,
        height: 10,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        shop: { findFirst: findShop, update },
        shopMember: { findUnique: findMembership },
      })
      .overrideProvider(AuthService)
      .useValue({ currentUser })
      .overrideProvider(ShopBannerStorage)
      .useValue(storage)
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
    currentUser.mockResolvedValue({ id: userId });
    role = 'OWNER';
    findMembership.mockImplementation(async ({ where }) =>
      where.userId_shopId.shopId === shopId
        ? { id: 'member', shopId, role, user: { isActive: true }, shop }
        : null,
    );
    findShop.mockResolvedValue(shop);
    update.mockResolvedValue({ ...shop, bannerUrl: uploaded.bannerUrl });
    storage.upload.mockResolvedValue(uploaded);
  });
  const post = (target = shopId, authenticated = true) => {
    const req = request(app.getHttpServer()).post(
      `/api/v1/shops/${target}/banner`,
    );
    return authenticated ? req.set('Authorization', 'Bearer valid') : req;
  };
  it('persists a tenant-scoped conditional banner write and returns public settings', async () => {
    const response = await post()
      .attach('file', image, {
        filename: 'banner.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.shop.bannerUrl).toBe(uploaded.bannerUrl);
    expect(response.body.shop.logoUrl).toBe(shop.logoUrl);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: shopId,
          isActive: true,
          bannerUrl: shop.bannerUrl,
          members: {
            some: {
              disabledAt: null,
              userId,
              role: 'OWNER',
              user: { isActive: true },
            },
          },
        },
        data: { bannerUrl: uploaded.bannerUrl },
      }),
    );
    expect(storage.upload.mock.calls[0][0]).toBe(shopId);
    const metadata = await sharp(storage.upload.mock.calls[0][1]).metadata();
    expect(metadata).toMatchObject({
      format: 'webp',
      width: 1920,
      height: 640,
      hasAlpha: true,
    });
    expect(storage.removePrevious).toHaveBeenCalledWith(shopId, shop.bannerUrl);
  });
  it.each(['ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN'])(
    'denies %s before uploading',
    async (value) => {
      role = value;
      await post().attach('file', image, 'banner.png').expect(403);
      expect(storage.upload).not.toHaveBeenCalled();
    },
  );
  it('rejects nonmembers and unauthenticated requests', async () => {
    await post(otherShopId).attach('file', image, 'banner.png').expect(404);
    await post(shopId, false).attach('file', image, 'banner.png').expect(401);
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('rejects missing, spoofed, unsupported and extra multipart input', async () => {
    await post().expect(400);
    await post()
      .attach('file', Buffer.from('<svg/>'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);
    await post()
      .attach('file', image, {
        filename: 'fake.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    await post()
      .field('shopId', otherShopId)
      .attach('file', image, 'banner.png')
      .expect(400);
    await post()
      .attach('file', image, 'banner.png')
      .attach('file', image, 'other.png')
      .expect(400);
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('rejects oversized files', async () => {
    await post()
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: 'large.png',
        contentType: 'image/png',
      })
      .expect(413);
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('cleans only the new object when a concurrent replacement wins', async () => {
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('changed', {
        code: 'P2025',
        clientVersion: '7',
      }),
    );
    const response = await post()
      .attach('file', image, 'banner.png')
      .expect(409);
    expect(response.body.code).toBe('SHOP_BANNER_CHANGED');
    expect(storage.remove).toHaveBeenCalledWith(uploaded.storagePath);
    expect(storage.removePrevious).not.toHaveBeenCalled();
  });
  it('rechecks owner access when the conditional write loses authorization', async () => {
    storage.upload.mockImplementation(async () => {
      role = 'MANAGER';
      return uploaded;
    });
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('changed', {
        code: 'P2025',
        clientVersion: '7',
      }),
    );
    await post().attach('file', image, 'banner.png').expect(403);
    expect(storage.remove).toHaveBeenCalledWith(uploaded.storagePath);
    expect(storage.removePrevious).not.toHaveBeenCalled();
  });
  it('retains objects on an uncertain database outcome', async () => {
    update.mockRejectedValue(new Error('Connection dropped'));
    const response = await post()
      .attach('file', image, 'banner.png')
      .expect(503);
    expect(response.body.code).toBe('SHOP_BANNER_SAVE_UNCERTAIN');
    expect(storage.remove).not.toHaveBeenCalled();
    expect(storage.removePrevious).not.toHaveBeenCalled();
  });
  it('never changes the database reference when storage upload fails', async () => {
    storage.upload.mockRejectedValue(
      new ServiceUnavailableException({
        code: 'SHOP_BANNER_STORAGE_UNAVAILABLE',
      }),
    );
    const response = await post()
      .attach('file', image, 'banner.png')
      .expect(503);
    expect(response.body.code).toBe('SHOP_BANNER_STORAGE_UNAVAILABLE');
    expect(update).not.toHaveBeenCalled();
    expect(storage.removePrevious).not.toHaveBeenCalled();
  });
});
