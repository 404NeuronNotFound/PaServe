import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { TablesController } from './tables.controller.js';
import { TablesRepository } from './tables.repository.js';
import { TablesService } from './tables.service.js';

@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [TablesController],
  providers: [TablesRepository, TablesService],
})
export class TablesModule {}
