import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsUUID,
} from 'class-validator';
import {
  PRODUCT_REORDER_MAX,
  type ReorderFeaturedProductsRequest,
} from '@paserve/contracts';

export class ReorderFeaturedProductsDto implements ReorderFeaturedProductsRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRODUCT_REORDER_MAX)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  productIds!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRODUCT_REORDER_MAX)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  expectedOrder!: string[];
}
