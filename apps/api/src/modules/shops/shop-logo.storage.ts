import {
  Injectable,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
export const SHOP_LOGO_BUCKET = 'paserve-assets';
@Injectable()
export class ShopLogoStorage {
  private client?: SupabaseClient;
  private readonly logger = new Logger(ShopLogoStorage.name);
  constructor(private readonly config: ConfigService) {}
  private admin() {
    if (!this.client) {
      const url = this.config.get<string>('SUPABASE_URL'),
        key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !key)
        throw new ServiceUnavailableException({
          code: 'SHOP_LOGO_STORAGE_UNAVAILABLE',
          message: 'Logo uploads are unavailable. Please try again later.',
        });
      this.client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return this.client;
  }
  async upload(shopId: string, buffer: Buffer) {
    const storagePath = `shops/${shopId}/branding/logo/${randomUUID()}.webp`;
    const bucket = this.admin().storage.from(SHOP_LOGO_BUCKET);
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
        code: 'SHOP_LOGO_STORAGE_UNAVAILABLE',
        message: 'The logo could not be uploaded. Your current logo is kept.',
      });
    }
    return {
      storagePath,
      logoUrl: bucket.getPublicUrl(storagePath).data.publicUrl,
    };
  }
  async removePrevious(shopId: string, logoUrl: string | null) {
    if (!logoUrl) return;
    // Never delete external media or objects owned by a different shop.
    for (const [bucketName, folder] of [
      [SHOP_LOGO_BUCKET, `shops/${shopId}/branding/logo/`],
      ['shop-media', `${shopId}/logo/`],
    ]) {
      const prefix = this.admin().storage.from(bucketName).getPublicUrl(folder)
        .data.publicUrl;
      if (!logoUrl.startsWith(prefix)) continue;
      const filename = logoUrl.slice(prefix.length);
      if (!/^[0-9a-f-]{36}\.webp$/.test(filename)) return;
      await this.remove(folder + filename, bucketName);
      return;
    }
  }

  async remove(storagePath: string, bucketName = SHOP_LOGO_BUCKET) {
    try {
      const { error } = await this.admin()
        .storage.from(bucketName)
        .remove([storagePath]);
      if (error) this.logger.warn('Shop logo cleanup needs retry.');
    } catch {
      this.logger.warn('Shop logo cleanup needs retry.');
    }
  }
}
