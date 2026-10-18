import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { randomUUID } from 'node:crypto';

export const ASSETS_BUCKET = 'paserve-assets';
export type BrandingImage = 'logo' | 'banner';

function requireId(value: string) {
  if (typeof value !== 'string' || !isUUID(value))
    throw new BadRequestException({
      code: 'INVALID_MEDIA_PATH',
      message: 'Valid shop and product IDs are required for media storage.',
    });
}

export function brandingFolder(shopId: string, kind: BrandingImage) {
  requireId(shopId);
  if (kind !== 'logo' && kind !== 'banner')
    throw new BadRequestException({
      code: 'INVALID_MEDIA_PATH',
      message: 'Choose a supported branding image type.',
    });
  return `shops/${shopId}/branding/${kind}/`;
}

export function productImageFolder(shopId: string, productId: string) {
  requireId(shopId);
  requireId(productId);
  return `shops/${shopId}/products/${productId}/`;
}

export function brandingImagePath(shopId: string, kind: BrandingImage) {
  return `${brandingFolder(shopId, kind)}${randomUUID()}.webp`;
}

export function productImagePath(shopId: string, productId: string) {
  return `${productImageFolder(shopId, productId)}${randomUUID()}.webp`;
}
