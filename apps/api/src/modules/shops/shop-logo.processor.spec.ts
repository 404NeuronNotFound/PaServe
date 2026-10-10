import sharp from 'sharp';
import { ShopLogoProcessor } from './shop-logo.processor.js';

const processor = new ShopLogoProcessor();
describe('shop logo processing', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'fits %s inside 512px without cropping and strips metadata',
    async (format) => {
      const buffer = await sharp({
        create: {
          width: 1000,
          height: 500,
          channels: 4,
          background: 'transparent',
        },
      })
        .withMetadata()
        .toFormat(format)
        .toBuffer();
      const result = await processor.process({
        buffer,
        size: buffer.length,
        mimetype: `image/${format}`,
      });
      const metadata = await sharp(result).metadata();
      expect(metadata).toMatchObject({
        format: 'webp',
        width: 512,
        height: 256,
      });
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      if (format !== 'jpeg') expect(metadata.hasAlpha).toBe(true);
    },
  );
  it('rejects excessive dimensions and truncated data', async () => {
    const buffer = await sharp({
      create: { width: 8193, height: 1, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    await expect(
      processor.process({ buffer, size: buffer.length, mimetype: 'image/png' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      processor.process({
        buffer: Buffer.from([255, 216, 255]),
        size: 3,
        mimetype: 'image/jpeg',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
