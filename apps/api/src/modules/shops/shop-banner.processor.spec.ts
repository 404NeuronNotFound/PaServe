import sharp from 'sharp';
import { ShopBannerProcessor } from './shop-banner.processor.js';

const processor = new ShopBannerProcessor();
describe('shop banner processing', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'normalizes %s to a 1920x640 banner and strips metadata',
    async (format) => {
      const buffer = await sharp({
        create: {
          width: 2400,
          height: 1200,
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
        width: 1920,
        height: 640,
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
  it('rejects images exceeding the pixel budget even within dimension limits', async () => {
    const buffer = await sharp({
      create: { width: 4001, height: 4000, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    await expect(
      processor.process({ buffer, size: buffer.length, mimetype: 'image/png' }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rejects animated WebP input', async () => {
    const buffer = await sharp(
      Buffer.concat([
        Buffer.alloc(20 * 20 * 3, 0),
        Buffer.alloc(20 * 20 * 3, 255),
      ]),
      { raw: { width: 20, height: 40, channels: 3, pageHeight: 20 } },
    )
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(buffer, { animated: true }).metadata()).pages).toBe(2);
    await expect(
      processor.process({
        buffer,
        size: buffer.length,
        mimetype: 'image/webp',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
