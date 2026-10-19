import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ProductImageStorage } from './product-image.storage.js';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ storage: { from: mocks.from } }),
}));
const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
const productId = '75992537-5d60-4d22-8e1e-60a114644681';
const base = 'https://assets.example/storage/v1/object/public/';
let storage: ProductImageStorage;
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
  storage = new ProductImageStorage(
    new ConfigService({
      SUPABASE_URL: 'https://assets.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test',
    }),
  );
});
it('uploads immutable WebP objects under the exact shop and product IDs', async () => {
  const first = await storage.upload(
    shopId,
    productId,
    Buffer.from('processed'),
  );
  const second = await storage.upload(
    shopId,
    productId,
    Buffer.from('processed'),
  );
  expect(first.storagePath).toMatch(
    new RegExp(`^shops/${shopId}/products/${productId}/[0-9a-f-]{36}\\.webp$`),
  );
  expect(first.imageUrl).toBe(base + 'paserve-assets/' + first.storagePath);
  expect(second.storagePath).not.toBe(first.storagePath);
  expect(mocks.upload).toHaveBeenCalledWith(
    first.storagePath,
    expect.any(Buffer),
    { upsert: false, contentType: 'image/webp', cacheControl: '31536000' },
  );
});
it.each(['returned error', 'thrown error'])(
  'cleans only the failed upload attempt: %s',
  async (mode) => {
    if (mode === 'returned error')
      mocks.upload.mockResolvedValue({ error: new Error('failed') });
    else mocks.upload.mockRejectedValue(new Error('failed'));
    await expect(
      storage.upload(shopId, productId, Buffer.from('processed')),
    ).rejects.toMatchObject({
      response: { code: 'PRODUCT_STORAGE_UNAVAILABLE' },
    });
    const path = mocks.upload.mock.calls[0][0];
    expect(path).toContain(`shops/${shopId}/products/${productId}/`);
    expect(mocks.from).toHaveBeenLastCalledWith('paserve-assets');
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([path]);
  },
);
it('fails before upload if server credentials are unavailable', async () => {
  storage = new ProductImageStorage(new ConfigService({}));
  await expect(
    storage.upload(shopId, productId, Buffer.from('processed')),
  ).rejects.toMatchObject({
    response: { code: 'PRODUCT_STORAGE_UNAVAILABLE' },
  });
  expect(mocks.upload).not.toHaveBeenCalled();
});
it.each(['returned error', 'thrown error'])(
  'logs cleanup failure for reconciliation: %s',
  async (mode) => {
    const warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      if (mode === 'returned error')
        mocks.remove.mockResolvedValue({ error: new Error('failed') });
      else mocks.remove.mockRejectedValue(new Error('failed'));
      await expect(
        storage.remove(`shops/${shopId}/products/${productId}/fixture.webp`),
      ).resolves.toBeUndefined();
      expect(warning).toHaveBeenCalledWith(
        'Product image cleanup needs retry.',
      );
    } finally {
      warning.mockRestore();
    }
  },
);

it.each([
  ['paserve-assets', `shops/${shopId}/products/${productId}/`],
  ['product-media', `${shopId}/${productId}/`],
])('recognizes only an exact owned reference in %s', (bucketName, folder) => {
  const filename = 'b77f1e28-723e-49db-8a42-3cad7dca35f7.webp';
  expect(
    storage.ownedReference(
      shopId,
      productId,
      base + bucketName + '/' + folder + filename,
    ),
  ).toEqual({ bucketName, storagePath: folder + filename });
});
it.each([
  base +
    `paserve-assets/shops/other/products/${productId}/b77f1e28-723e-49db-8a42-3cad7dca35f7.webp`,
  base +
    `paserve-assets/shops/${shopId}/products/other/b77f1e28-723e-49db-8a42-3cad7dca35f7.webp`,
  base +
    `paserve-assets/shops/${shopId}/products/${productId}/../b77f1e28-723e-49db-8a42-3cad7dca35f7.webp`,
  base +
    `paserve-assets/shops/${shopId}/products/${productId}/b77f1e28-723e-49db-8a42-3cad7dca35f7.webp?x=1`,
  'https://other.example/image.webp',
])('rejects a foreign or noncanonical stored reference: %s', (url) => {
  expect(storage.ownedReference(shopId, productId, url)).toBeNull();
});

it.each([
  ['{actualShopId}', productId],
  [shopId, '{productId}'],
])(
  'rejects placeholder tenant/resource IDs before contacting storage',
  async (shop, product) => {
    await expect(
      storage.upload(shop, product, Buffer.from('processed')),
    ).rejects.toMatchObject({ response: { code: 'INVALID_MEDIA_PATH' } });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  },
);

it.each([409, '409'])(
  'never deletes the existing object on upload conflict: %s',
  async (statusCode) => {
    mocks.upload.mockResolvedValue({
      error: { statusCode, message: 'Object already exists' },
    });
    await expect(
      storage.upload(shopId, productId, Buffer.from('processed')),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.remove).not.toHaveBeenCalled();
  },
);
