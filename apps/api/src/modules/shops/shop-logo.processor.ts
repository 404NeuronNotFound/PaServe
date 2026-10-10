import {
  Injectable,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import sharp from 'sharp';
import { SHOP_LOGO_LIMITS, SHOP_LOGO_TYPES } from '@paserve/contracts';
export type ShopLogoFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
};
@Injectable()
export class ShopLogoProcessor {
  async process(file?: ShopLogoFile): Promise<Buffer> {
    const invalid = () =>
      new BadRequestException({
        code: 'INVALID_SHOP_LOGO',
        message: 'Choose a valid JPEG, PNG or WebP image.',
        fieldErrors: { file: ['Choose a valid JPEG, PNG or WebP image.'] },
      });
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0)
      throw invalid();
    if (
      file.buffer.length > SHOP_LOGO_LIMITS.maxBytes ||
      file.size > SHOP_LOGO_LIMITS.maxBytes
    )
      throw new PayloadTooLargeException({
        code: 'SHOP_LOGO_TOO_LARGE',
        message: 'Choose an image no larger than 5 MB.',
      });
    if (!(SHOP_LOGO_TYPES as readonly string[]).includes(file.mimetype))
      throw invalid();
    // Reject unsupported formats before a decoder can handle SVG or other active content.
    const buffer = file.buffer;
    const format = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      ? 'jpeg'
      : buffer
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'png'
        : buffer.toString('ascii', 0, 4) === 'RIFF' &&
            buffer.toString('ascii', 8, 12) === 'WEBP'
          ? 'webp'
          : null;
    if (!format || file.mimetype !== `image/${format}`) throw invalid();
    try {
      const image = sharp(buffer, {
        limitInputPixels: SHOP_LOGO_LIMITS.maxPixels,
        failOn: 'warning',
        animated: true,
      });
      const metadata = await image.metadata();
      if (
        metadata.format !== format ||
        !metadata.width ||
        !metadata.height ||
        (metadata.pages ?? 1) > 1 ||
        metadata.width > SHOP_LOGO_LIMITS.maxDimension ||
        metadata.height > SHOP_LOGO_LIMITS.maxDimension ||
        metadata.width * metadata.height > SHOP_LOGO_LIMITS.maxPixels
      )
        throw invalid();
      const output = await image
        .rotate()
        .resize({
          width: SHOP_LOGO_LIMITS.outputDimension,
          height: SHOP_LOGO_LIMITS.outputDimension,
          fit: 'cover',
        })
        .webp({ quality: 90 })
        .toBuffer();
      if (output.length > SHOP_LOGO_LIMITS.maxBytes) throw invalid();
      return output;
    } catch {
      throw invalid();
    }
  }
}
