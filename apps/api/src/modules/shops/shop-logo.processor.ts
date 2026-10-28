import {
  Injectable,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import sharp from 'sharp';
import {
  validateImageUpload,
  type ImageUploadFile,
} from '../../common/storage/image-upload.js';
import { SHOP_LOGO_LIMITS, SHOP_LOGO_TYPES } from '@paserve/contracts';
export type ShopLogoFile = ImageUploadFile;
@Injectable()
export class ShopLogoProcessor {
  async process(file?: ShopLogoFile): Promise<Buffer> {
    const invalid = () =>
      new BadRequestException({
        code: 'INVALID_SHOP_LOGO',
        message: 'Choose a valid JPEG, PNG or WebP image.',
        fieldErrors: { file: ['Choose a valid JPEG, PNG or WebP image.'] },
      });
    const { buffer, format } = validateImageUpload(
      file,
      SHOP_LOGO_LIMITS.maxBytes,
      SHOP_LOGO_TYPES,
      invalid,
      () =>
        new PayloadTooLargeException({
          code: 'SHOP_LOGO_TOO_LARGE',
          message: 'Choose an image no larger than 5 MB.',
        }),
    );
    try {
      const image = sharp(buffer, {
        limitInputPixels: SHOP_LOGO_LIMITS.maxPixels,
        failOn: 'warning',
        animated: true,
      });
      const metadata = await image.metadata();
      image.timeout({ seconds: 5 });
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
