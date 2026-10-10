import { IsBoolean } from 'class-validator';
import type { ProductFeaturedRequest } from '@paserve/contracts';
export class ProductFeaturedDto implements ProductFeaturedRequest {
  @IsBoolean()
  isFeatured!: boolean;
  @IsBoolean()
  expectedFeatured!: boolean;
}
