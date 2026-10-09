import { Module } from '@nestjs/common';
import { ShopMembersModule } from '../shop-members/shop-members.module.js';
import { TenantResourcesRepository } from './tenant-resources.repository.js';
import { TenantResourcesService } from './tenant-resources.service.js';
import { ShopResourceGuard } from './shop-resource.guard.js';

@Module({
  imports: [ShopMembersModule],
  providers: [
    TenantResourcesRepository,
    TenantResourcesService,
    ShopResourceGuard,
  ],
  exports: [TenantResourcesService, ShopResourceGuard, ShopMembersModule],
})
export class TenancyModule {}
