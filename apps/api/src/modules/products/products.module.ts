import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { ProductsRepository } from './products.repository.js';
import { ProductImageService } from './product-image.service.js';
import { ProductImageProcessor } from './product-image.processor.js';
import { ProductImageStorage } from './product-image.storage.js';

@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [ProductsController],
  providers: [
    ProductsService,
    ProductsRepository,
    ProductImageService,
    ProductImageProcessor,
    ProductImageStorage,
  ],
})
export class ProductsModule {}
