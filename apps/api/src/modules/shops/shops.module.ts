import { Module } from '@nestjs/common';
import { ShopsController } from './shops.controller.js';
import { ShopsService } from './shops.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { ShopsRepository } from './shops.repository.js';
import { ShopMembersModule } from '../shop-members/shop-members.module.js';
import { ShopLogoController } from './shop-logo.controller.js';
import { ShopLogoService } from './shop-logo.service.js';
import { ShopLogoProcessor } from './shop-logo.processor.js';
import { ShopLogoStorage } from './shop-logo.storage.js';
import { ShopBannerController } from './shop-banner.controller.js';
import { ShopBannerService } from './shop-banner.service.js';
import { ShopBannerProcessor } from './shop-banner.processor.js';
import { ShopBannerStorage } from './shop-banner.storage.js';

@Module({
  imports: [AuthModule, ShopMembersModule],
  controllers: [ShopsController, ShopLogoController, ShopBannerController],
  providers: [
    ShopsService,
    ShopsRepository,
    ShopLogoService,
    ShopLogoProcessor,
    ShopLogoStorage,
    ShopBannerService,
    ShopBannerProcessor,
    ShopBannerStorage,
  ],
})
export class ShopsModule {}
