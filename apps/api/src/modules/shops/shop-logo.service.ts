import {
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ShopLogoResponse } from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { ShopsRepository } from './shops.repository.js';
import { ShopLogoProcessor, type ShopLogoFile } from './shop-logo.processor.js';
import { ShopLogoStorage } from './shop-logo.storage.js';

@Injectable()
export class ShopLogoService {
  constructor(
    private readonly repository: ShopsRepository,
    private readonly members: ShopMembersService,
    private readonly processor: ShopLogoProcessor,
    private readonly storage: ShopLogoStorage,
  ) {}

  async upload(
    userId: string,
    shopId: string,
    file?: ShopLogoFile,
  ): Promise<ShopLogoResponse> {
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
      shop = await this.repository.updateLogo(
        userId,
        shopId,
        previous.logoUrl,
        uploaded.logoUrl,
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
          code: 'SHOP_LOGO_CHANGED',
          message:
            'The logo changed during upload. Refresh shop settings before trying again.',
        });
      }
      // An uncertain write may have committed. Preserve both objects until reconciled.
      throw new ServiceUnavailableException({
        code: 'SHOP_LOGO_SAVE_UNCERTAIN',
        message:
          'We could not confirm the logo save. Refresh shop settings before trying again.',
      });
    }
    await this.storage.removePrevious(shopId, previous.logoUrl);
    return {
      shop: { ...shop, createdAt: shop.createdAt.toISOString() },
      storagePath: uploaded.storagePath,
    };
  }
}
