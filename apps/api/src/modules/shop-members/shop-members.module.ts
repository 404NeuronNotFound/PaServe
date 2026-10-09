import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { ShopMembersRepository } from './shop-members.repository.js';
import { ShopMembersService } from './shop-members.service.js';
import { ShopMembershipGuard } from './guards/shop-membership.guard.js';
import { ShopOwnerGuard } from './guards/shop-owner.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  providers: [
    ShopMembersRepository,
    ShopMembersService,
    ShopMembershipGuard,
    ShopOwnerGuard,
    RolesGuard,
  ],
  exports: [
    ShopMembersService,
    ShopMembershipGuard,
    ShopOwnerGuard,
    RolesGuard,
    AuthModule,
  ],
})
export class ShopMembersModule {}
