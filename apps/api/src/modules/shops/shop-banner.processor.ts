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
import { SHOP_BANNER_LIMITS, SHOP_BANNER_TYPES } from '@paserve/contracts';
export type ShopBannerFile = ImageUploadFile;
@Injectable()
export class ShopBannerProcessor {
  async process(file?: ShopBannerFile): Promise<Buffer> {
    const invalid = () =>
      new BadRequestException({
        code: 'INVALID_SHOP_BANNER',
        message: 'Choose a valid JPEG, PNG or WebP image.',
        fieldErrors: { file: ['Choose a valid JPEG, PNG or WebP image.'] },
      });
    const { buffer, format } = validateImageUpload(
      file,
      SHOP_BANNER_LIMITS.maxBytes,
      SHOP_BANNER_TYPES,
      invalid,
      () =>
        new PayloadTooLargeException({
          code: 'SHOP_BANNER_TOO_LARGE',
          message: 'Choose an image no larger than 5 MB.',
        }),
    );
    try {
      const image = sharp(buffer, {
        limitInputPixels: SHOP_BANNER_LIMITS.maxPixels,
        failOn: 'warning',
        animated: true,
      });
      const metadata = await image.metadata();
      if (
        metadata.format !== format ||
        !metadata.width ||
        !metadata.height ||
        (metadata.pages ?? 1) > 1 ||
        metadata.width > SHOP_BANNER_LIMITS.maxDimension ||
        metadata.height > SHOP_BANNER_LIMITS.maxDimension ||
        metadata.width * metadata.height > SHOP_BANNER_LIMITS.maxPixels
      )
        throw invalid();
      const output = await image
        .rotate()
        .resize({
          width: SHOP_BANNER_LIMITS.outputWidth,
          height: SHOP_BANNER_LIMITS.outputHeight,
          fit: 'cover',
        })
        .webp({ quality: 90 })
        .toBuffer();
      if (output.length > SHOP_BANNER_LIMITS.maxBytes) throw invalid();
      return output;
    } catch {
      throw invalid();
    }
  }
}
