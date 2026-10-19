import sharp from 'sharp';
import { ProductImageProcessor } from '../../modules/products/product-image.processor.js';
import { ShopLogoProcessor } from '../../modules/shops/shop-logo.processor.js';
import { ShopBannerProcessor } from '../../modules/shops/shop-banner.processor.js';

describe.each([
  ['product', new ProductImageProcessor(), 'INVALID_PRODUCT_IMAGE'],
  ['logo', new ShopLogoProcessor(), 'INVALID_SHOP_LOGO'],
  ['banner', new ShopBannerProcessor(), 'INVALID_SHOP_BANNER'],
] as const)('%s upload validation', (_name, processor, code) => {
  let png: Buffer;
  beforeAll(async () => {
    png = await sharp({
      create: { width: 2, height: 3, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
  });
  it.each([
    'photo.jpg',
    'photo.webp',
    'photo.svg',
    'photo.php',
    'photo.png.exe',
    'photo',
    'photo.png.',
    'photo.png ',
    '../photo.png',
    'folder\\photo.png',
    'photo\x00.png',
    'photo\n.png',
    '',
  ])(
    'rejects invalid or mismatched filename %j before persistence',
    async (originalname) => {
      await expect(
        processor.process({
          buffer: png,
          size: png.length,
          mimetype: 'image/png',
          originalname,
        }),
      ).rejects.toMatchObject({ status: 400, response: { code } });
    },
  );
  it.each(['MENU.PNG', 'café lunch.png'])(
    'accepts matching extensions with case/Unicode names: %s',
    async (originalname) => {
      const output = await processor.process({
        buffer: png,
        size: png.length,
        mimetype: 'image/png',
        originalname,
      });
      expect((await sharp(output).metadata()).format).toBe('webp');
    },
  );
  it.each(['jpg', 'jpeg', 'JPG', 'JPEG'])(
    'accepts JPEG extension alias %s',
    async (extension) => {
      const buffer = await sharp(png).jpeg().toBuffer();
      const output = await processor.process({
        buffer,
        size: buffer.length,
        mimetype: 'image/jpeg',
        originalname: `photo.${extension}`,
      });
      expect((await sharp(output).metadata()).format).toBe('webp');
    },
  );
  it.each([NaN, -1, 0, 1.5])('rejects invalid file size %s', async (size) => {
    await expect(
      processor.process({
        buffer: png,
        size,
        mimetype: 'image/png',
        originalname: 'photo.png',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rejects missing filename metadata', async () => {
    await expect(
      processor.process({
        buffer: png,
        size: png.length,
        mimetype: 'image/png',
        originalname: undefined as unknown as string,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
