import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { ShopMembersModule } from '../shop-members/shop-members.module.js';
import { CategoriesController } from './categories.controller.js';
import { CategoriesRepository } from './categories.repository.js';
import { CategoriesService } from './categories.service.js';
@Module({
  imports: [DatabaseModule, ShopMembersModule],
  controllers: [CategoriesController],
  providers: [CategoriesRepository, CategoriesService],
})
export class CategoriesModule {}
