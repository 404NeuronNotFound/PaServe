import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { ProductsRepository } from './products.repository.js';

@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductsRepository],
})
export class ProductsModule {}
