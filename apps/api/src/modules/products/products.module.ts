import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { ProductsRepository } from './products.repository.js';
import { ProductImageService } from './product-image.service.js';
import { ProductImageProcessor } from './product-image.processor.js';
import { ProductImageStorage } from './product-image.storage.js';
import { ProductVariantsController } from './product-variants.controller.js';
import { ProductVariantsRepository } from './product-variants.repository.js';
import { ProductVariantsService } from './product-variants.service.js';
import { PublicProductController } from './public-product.controller.js';
import { PublicProductRepository } from './public-product.repository.js';
import { PublicProductService } from './public-product.service.js';

@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [
    ProductsController,
    ProductVariantsController,
    PublicProductController,
  ],
  providers: [
    ProductsService,
    ProductsRepository,
    ProductImageService,
    ProductImageProcessor,
    ProductImageStorage,
    ProductVariantsRepository,
    ProductVariantsService,
    PublicProductRepository,
    PublicProductService,
  ],
})
export class ProductsModule {}
