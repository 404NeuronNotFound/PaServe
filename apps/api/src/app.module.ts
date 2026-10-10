import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AuthModule } from './modules/auth/auth.module.js';
import { ShopsModule } from './modules/shops/shops.module.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { requestValidationPipe } from './common/pipes/request-validation.pipe.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';
import { CategoriesModule } from './modules/categories/categories.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { AddOnsModule } from './modules/add-ons/add-ons.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    AuthModule,
    ShopsModule,
    TenancyModule,
    CategoriesModule,
    ProductsModule,
    AddOnsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_PIPE, useFactory: requestValidationPipe },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
