import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import {
  AddOnsController,
  ProductAddOnsController,
  PublicAddOnsController,
} from './add-ons.controller.js';
import { AddOnsRepository } from './add-ons.repository.js';
import { AddOnsService } from './add-ons.service.js';

@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [
    AddOnsController,
    ProductAddOnsController,
    PublicAddOnsController,
  ],
  providers: [AddOnsRepository, AddOnsService],
  exports: [AddOnsService],
})
export class AddOnsModule {}
