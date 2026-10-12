import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { CategoriesController } from './categories.controller.js';
import { CategoriesRepository } from './categories.repository.js';
import { CategoriesService } from './categories.service.js';
import { PublicMenuController } from './public-menu.controller.js';
import { PublicMenuRepository } from './public-menu.repository.js';
import { PublicTablesRepository } from '../tables/public-tables.repository.js';
import { TableContextService } from '../tables/table-context.service.js';
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [CategoriesController, PublicMenuController],
  providers: [
    CategoriesRepository,
    CategoriesService,
    PublicMenuRepository,
    PublicTablesRepository,
    TableContextService,
  ],
})
export class CategoriesModule {}
