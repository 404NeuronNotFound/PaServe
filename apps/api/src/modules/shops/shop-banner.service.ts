import {
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ShopBannerResponse } from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { ShopsRepository } from './shops.repository.js';
import {
  ShopBannerProcessor,
  type ShopBannerFile,
} from './shop-banner.processor.js';
import { ShopBannerStorage } from './shop-banner.storage.js';

@Injectable()
export class ShopBannerService {
  constructor(
    private readonly repository: ShopsRepository,
    private readonly members: ShopMembersService,
    private readonly processor: ShopBannerProcessor,
    private readonly storage: ShopBannerStorage,
  ) {}

  async upload(
    userId: string,
    shopId: string,
    file?: ShopBannerFile,
  ): Promise<ShopBannerResponse> {
    await this.members.requireOwner(userId, shopId);
    const previous = await this.repository.findSettings(userId, shopId);
    if (!previous)
      throw new ForbiddenException({
        code: 'OWNER_REQUIRED',
        message: 'Your owner access changed. Refresh shop settings.',
      });
    const buffer = await this.processor.process(file);
    const uploaded = await this.storage.upload(shopId, buffer);
    let shop;
    try {
      shop = await this.repository.updateBanner(
        userId,
        shopId,
        previous.bannerUrl,
        uploaded.bannerUrl,
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        // The conditional write definitely failed: remove only this attempt's object.
        await this.storage.remove(uploaded.storagePath);
        await this.members.requireOwner(userId, shopId);
        throw new ConflictException({
          code: 'SHOP_BANNER_CHANGED',
          message:
            'The banner changed during upload. Refresh shop settings before trying again.',
        });
      }
      // An uncertain write may have committed. Preserve both objects until reconciled.
      throw new ServiceUnavailableException({
        code: 'SHOP_BANNER_SAVE_UNCERTAIN',
        message:
          'We could not confirm the banner save. Refresh shop settings before trying again.',
      });
    }
    await this.storage.removePrevious(shopId, previous.bannerUrl);
    return {
      shop: { ...shop, createdAt: shop.createdAt.toISOString() },
      storagePath: uploaded.storagePath,
    };
  }
}
