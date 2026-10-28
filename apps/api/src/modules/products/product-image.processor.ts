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
import { PRODUCT_IMAGE_LIMITS, PRODUCT_IMAGE_TYPES } from '@paserve/contracts';
export type ProductImageFile = ImageUploadFile;
@Injectable()
export class ProductImageProcessor {
  async process(file?: ProductImageFile): Promise<Buffer> {
    const invalid = () =>
      new BadRequestException({
        code: 'INVALID_PRODUCT_IMAGE',
        message: 'Choose a valid JPEG, PNG or WebP image.',
        fieldErrors: { file: ['Choose a valid JPEG, PNG or WebP image.'] },
      });
    const { buffer, format } = validateImageUpload(
      file,
      PRODUCT_IMAGE_LIMITS.maxBytes,
      PRODUCT_IMAGE_TYPES,
      invalid,
      () =>
        new PayloadTooLargeException({
          code: 'PRODUCT_IMAGE_TOO_LARGE',
          message: 'Choose an image no larger than 5 MB.',
        }),
    );
    try {
      const image = sharp(buffer, {
        limitInputPixels: PRODUCT_IMAGE_LIMITS.maxPixels,
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
        metadata.width > PRODUCT_IMAGE_LIMITS.maxDimension ||
        metadata.height > PRODUCT_IMAGE_LIMITS.maxDimension ||
        metadata.width * metadata.height > PRODUCT_IMAGE_LIMITS.maxPixels
      )
        throw invalid();
      const output = await image.rotate().webp({ quality: 85 }).toBuffer();
      if (output.length > PRODUCT_IMAGE_LIMITS.maxBytes) throw invalid();
      return output;
    } catch {
      throw invalid();
    }
  }
}
