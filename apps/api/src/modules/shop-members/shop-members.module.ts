import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { ShopMembersRepository } from './shop-members.repository.js';
import { ShopMembersService } from './shop-members.service.js';
import { ShopMembershipGuard } from './guards/shop-membership.guard.js';

@Module({
  imports: [DatabaseModule],
  providers: [ShopMembersRepository, ShopMembersService, ShopMembershipGuard],
  exports: [ShopMembersService, ShopMembershipGuard],
})
export class ShopMembersModule {}
