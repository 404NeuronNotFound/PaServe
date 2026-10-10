import sharp from 'sharp';
import { ProductImageProcessor } from './product-image.processor.js';
const processor = new ProductImageProcessor();
describe('product image decoding', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'decodes %s, emits WebP and strips metadata',
    async (format) => {
      const buffer = await sharp({
        create: { width: 3, height: 2, channels: 3, background: 'red' },
      })
        .withMetadata()
        .toFormat(format)
        .toBuffer();
      const output = await processor.process({
        buffer,
        mimetype: `image/${format}`,
        size: buffer.length,
      });
      const metadata = await sharp(output).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    },
  );
  it('rejects images above the dimension limit', async () => {
    const buffer = await sharp({
      create: { width: 8193, height: 1, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    await expect(
      processor.process({ buffer, size: buffer.length, mimetype: 'image/png' }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rejects pixel counts above 16 megapixels', async () => {
    const buffer = await sharp({
      create: { width: 3000, height: 6000, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    await expect(
      processor.process({ buffer, size: buffer.length, mimetype: 'image/png' }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rejects truncated real-format data', async () => {
    await expect(
      processor.process({
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0]),
        mimetype: 'image/jpeg',
        size: 4,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
