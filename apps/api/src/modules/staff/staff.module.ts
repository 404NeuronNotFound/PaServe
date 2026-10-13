import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { ShopMembersModule } from '../shop-members/shop-members.module.js';
import { StaffService } from './staff.service.js';
import {
  StaffController,
  StaffInvitationController,
} from './staff.controller.js';

@Module({
  imports: [DatabaseModule, ShopMembersModule],
  controllers: [StaffController, StaffInvitationController],
  providers: [StaffService],
})
export class StaffModule {}
