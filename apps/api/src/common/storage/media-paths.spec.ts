import {
  brandingFolder,
  brandingImagePath,
  productImageFolder,
  productImagePath,
  ASSETS_BUCKET,
} from './media-paths.js';
const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
const productId = '75992537-5d60-4d22-8e1e-60a114644681';
const filename =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
it('keeps the bucket separate from object paths', () => {
  expect(ASSETS_BUCKET).toBe('paserve-assets');
  expect(brandingFolder(shopId, 'logo')).toBe(`shops/${shopId}/branding/logo/`);
  expect(brandingFolder(shopId, 'banner')).toBe(
    `shops/${shopId}/branding/banner/`,
  );
  expect(productImageFolder(shopId, productId)).toBe(
    `shops/${shopId}/products/${productId}/`,
  );
});
it('generates unique concrete paths for all media types without literal braces', () => {
  const paths = [
    brandingImagePath(shopId, 'logo'),
    brandingImagePath(shopId, 'banner'),
    productImagePath(shopId, productId),
    productImagePath(shopId, productId),
  ];
  expect(new Set(paths).size).toBe(paths.length);
  for (const path of paths) {
    expect(path).not.toMatch(/[{}]|paserve-assets|actualShopId|productId/);
    expect(path.split('/').at(-1)).toMatch(filename);
    expect(path.startsWith(`shops/${shopId}/`)).toBe(true);
  }
});
it.each([
  '{actualShopId}',
  '{shopId}',
  '${shopId}',
  'actualShopId',
  '',
  '../shop',
  'shop/product',
  '%7BactualShopId%7D',
  shopId + '/',
  ' ' + shopId,
  undefined,
  null,
])(
  'rejects placeholder or unsafe IDs before constructing any media path: %s',
  (invalid) => {
    for (const build of [
      () => brandingImagePath(invalid as string, 'logo'),
      () => brandingImagePath(invalid as string, 'banner'),
      () => productImagePath(invalid as string, productId),
      () => productImagePath(shopId, invalid as string),
    ]) {
      expect(build).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'INVALID_MEDIA_PATH' }),
        }),
      );
    }
  },
);
it('rejects unknown branding folders', () => {
  expect(() => brandingImagePath(shopId, 'products' as 'logo')).toThrow();
});
