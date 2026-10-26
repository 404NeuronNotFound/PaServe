import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { ShopMembersModule } from '../shop-members/shop-members.module.js';
import { StaffService } from './staff.service.js';
import { AccountNotificationsService } from './account-notifications.service.js';
import { AccountNotificationsController } from './account-notifications.controller.js';
import {
  StaffController,
  StaffInvitationController,
} from './staff.controller.js';

@Module({
  imports: [DatabaseModule, ShopMembersModule],
  controllers: [StaffController, StaffInvitationController, AccountNotificationsController],
  providers: [StaffService, AccountNotificationsService],
})
export class StaffModule {}
