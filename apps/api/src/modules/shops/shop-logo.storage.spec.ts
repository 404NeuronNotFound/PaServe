import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ShopLogoStorage } from './shop-logo.storage.js';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ storage: { from: mocks.from } }),
}));
const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
const filename = '75992537-5d60-4d22-8e1e-60a114644681.webp';
const base = 'https://assets.example/storage/v1/object/public/';
let storage: ShopLogoStorage;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((bucket: string) => ({
    upload: mocks.upload,
    remove: mocks.remove,
    getPublicUrl: (path: string) => ({
      data: { publicUrl: base + bucket + '/' + path },
    }),
  }));
  storage = new ShopLogoStorage(
    new ConfigService({
      SUPABASE_URL: 'https://assets.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test',
    }),
  );
});
it('uploads immutable WebP objects under the actual shop branding path', async () => {
  const result = await storage.upload(shopId, Buffer.from('processed'));
  expect(result.storagePath).toMatch(
    new RegExp(`^shops/${shopId}/branding/logo/[0-9a-f-]{36}\\.webp$`),
  );
  expect(result.logoUrl).toBe(base + 'paserve-assets/' + result.storagePath);
  expect(mocks.upload).toHaveBeenCalledWith(
    result.storagePath,
    expect.any(Buffer),
    expect.objectContaining({ upsert: false, contentType: 'image/webp' }),
  );
});
it.each([
  ['paserve-assets', `shops/${shopId}/branding/logo/`],
  ['shop-media', `${shopId}/logo/`],
])('cleans owned logos in %s', async (bucket, folder) => {
  await storage.removePrevious(shopId, base + bucket + '/' + folder + filename);
  expect(mocks.from).toHaveBeenLastCalledWith(bucket);
  expect(mocks.remove).toHaveBeenCalledWith([folder + filename]);
});
it.each([
  null,
  base + 'paserve-assets/shops/other/branding/logo/' + filename,
  base + `paserve-assets/shops/${shopId}/branding/banner/` + filename,
  base + `paserve-assets/shops/${shopId}/branding/logo/../` + filename,
  base + `paserve-assets/shops/${shopId}/branding/logo/` + filename + '?x=1',
  'https://external.example/' + filename,
])('never deletes unowned or invalid URLs: %s', async (url) => {
  await storage.removePrevious(shopId, url);
  expect(mocks.remove).not.toHaveBeenCalled();
});
it('cleans a failed upload attempt and returns a recoverable error', async () => {
  mocks.upload.mockResolvedValue({ error: new Error('failed') });
  await expect(
    storage.upload(shopId, Buffer.from('processed')),
  ).rejects.toMatchObject({
    response: { code: 'SHOP_LOGO_STORAGE_UNAVAILABLE' },
  });
  expect(mocks.remove).toHaveBeenCalledTimes(1);
});

it.each(['returned error', 'thrown error'])(
  'logs a cleanup failure without undoing the saved logo state: %s',
  async (mode) => {
    const warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      if (mode === 'returned error')
        mocks.remove.mockResolvedValue({
          error: new Error('storage unavailable'),
        });
      else mocks.remove.mockRejectedValue(new Error('storage unavailable'));
      await expect(
        storage.removePrevious(
          shopId,
          base + `paserve-assets/shops/${shopId}/branding/logo/` + filename,
        ),
      ).resolves.toBeUndefined();
      expect(warning).toHaveBeenCalledWith('Shop logo cleanup needs retry.');
      expect(mocks.remove).toHaveBeenCalledWith([
        `shops/${shopId}/branding/logo/` + filename,
      ]);
    } finally {
      warning.mockRestore();
    }
  },
);

it('rejects literal placeholder shop IDs before contacting storage', async () => {
  await expect(
    storage.upload('{actualShopId}', Buffer.from('processed')),
  ).rejects.toMatchObject({ response: { code: 'INVALID_MEDIA_PATH' } });
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});

it.each([409, '409'])(
  'never removes an existing object when an immutable upload reports a conflict: %s',
  async (statusCode) => {
    mocks.upload.mockResolvedValue({
      error: { statusCode, message: 'Object already exists' },
    });
    await expect(
      storage.upload(shopId, Buffer.from('processed')),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.remove).not.toHaveBeenCalled();
  },
);
