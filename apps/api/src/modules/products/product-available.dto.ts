import { IsIn } from 'class-validator';
import {
  PRODUCT_STATUSES,
  type ProductAvailableRequest,
  type ProductStatus,
} from '@paserve/contracts';
export class ProductAvailableDto implements ProductAvailableRequest {
  @IsIn(PRODUCT_STATUSES)
  expectedStatus!: ProductStatus;
}
