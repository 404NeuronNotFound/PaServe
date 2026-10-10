import {
  Injectable,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
export const PRODUCT_IMAGE_BUCKET = 'product-media';
@Injectable()
export class ProductImageStorage {
  private client?: SupabaseClient;
  private readonly logger = new Logger(ProductImageStorage.name);
  constructor(private readonly config: ConfigService) {}
  private admin() {
    if (!this.client) {
      const url = this.config.get<string>('SUPABASE_URL'),
        key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !key)
        throw new ServiceUnavailableException({
          code: 'PRODUCT_STORAGE_UNAVAILABLE',
          message: 'Image uploads are unavailable. Please try again later.',
        });
      this.client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return this.client;
  }
  async upload(shopId: string, productId: string, buffer: Buffer) {
    const storagePath = `${shopId}/${productId}/${randomUUID()}.webp`;
    const bucket = this.admin().storage.from(PRODUCT_IMAGE_BUCKET);
    try {
      const { error } = await bucket.upload(storagePath, buffer, {
        contentType: 'image/webp',
        upsert: false,
        cacheControl: '31536000',
      });
      if (error) throw error;
    } catch {
      await this.remove(storagePath);
      throw new ServiceUnavailableException({
        code: 'PRODUCT_STORAGE_UNAVAILABLE',
        message: 'The image could not be uploaded. Your current image is kept.',
      });
    }
    return {
      storagePath,
      imageUrl: bucket.getPublicUrl(storagePath).data.publicUrl,
    };
  }
  async remove(storagePath: string) {
    try {
      const { error } = await this.admin()
        .storage.from(PRODUCT_IMAGE_BUCKET)
        .remove([storagePath]);
      if (error) this.logger.warn('Product image cleanup needs retry.');
    } catch {
      this.logger.warn('Product image cleanup needs retry.');
    }
  }
}
