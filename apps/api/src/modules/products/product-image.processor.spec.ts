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
  it('rejects animated WebP', async () => {
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
  it.each([
    'image/svg+xml',
    'image/gif',
    'application/octet-stream',
    'image/jpeg',
  ])('rejects unsupported or mismatched MIME type: %s', async (mimetype) => {
    const buffer = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    await expect(
      processor.process({ buffer, size: buffer.length, mimetype }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rejects empty and missing files', async () => {
    await expect(processor.process()).rejects.toMatchObject({ status: 400 });
    await expect(
      processor.process({
        buffer: Buffer.alloc(0),
        size: 0,
        mimetype: 'image/png',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('enforces the byte limit from both the buffer and multipart size', async () => {
    await expect(
      processor.process({
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
        size: 1,
        mimetype: 'image/png',
      }),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      processor.process({
        buffer: Buffer.from('x'),
        size: 5 * 1024 * 1024 + 1,
        mimetype: 'image/png',
      }),
    ).rejects.toMatchObject({ status: 413 });
  });
});
