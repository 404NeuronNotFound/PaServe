import { Module } from '@nestjs/common';
import { ShopMembersModule } from '../shop-members/shop-members.module.js';
import { NewOrderEventsService } from '../orders/new-order-events.service.js';

/** One private broadcast relay shared by order and public-menu SSE endpoints. */
@Module({
  imports: [ShopMembersModule],
  providers: [NewOrderEventsService],
  exports: [NewOrderEventsService],
})
export class RealtimeModule {}
