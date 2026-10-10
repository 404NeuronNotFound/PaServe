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

@Module({
  imports: [AuthModule, ShopMembersModule],
  controllers: [ShopsController, ShopLogoController],
  providers: [
    ShopsService,
    ShopsRepository,
    ShopLogoService,
    ShopLogoProcessor,
    ShopLogoStorage,
  ],
})
export class ShopsModule {}
