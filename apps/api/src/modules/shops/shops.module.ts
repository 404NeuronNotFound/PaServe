import { Module } from '@nestjs/common';
import { ShopsController } from './shops.controller.js';
import { ShopsService } from './shops.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { ShopsRepository } from './shops.repository.js';
import { ShopMembersModule } from '../shop-members/shop-members.module.js';

@Module({
  imports: [AuthModule, ShopMembersModule],
  controllers: [ShopsController],
  providers: [ShopsService, ShopsRepository],
})
export class ShopsModule {}
