import {
  Module,
  type NestModule,
  type MiddlewareConsumer,
} from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { RateLimitingModule } from '../rate-limiting/rate-limiting.module.js';
import { ApiObservabilityService } from './api-observability.service.js';

@Module({
  imports: [DatabaseModule, RateLimitingModule],
  providers: [ApiObservabilityService],
  exports: [ApiObservabilityService],
})
export class ApiObservabilityModule implements NestModule {
  constructor(private readonly metrics: ApiObservabilityService) {}
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(this.metrics.observe.bind(this.metrics))
      .forRoutes('{*path}');
  }
}
