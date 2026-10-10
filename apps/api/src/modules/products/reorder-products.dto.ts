import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import {
  PRODUCT_REORDER_MAX,
  type ReorderProductsRequest,
} from '@paserve/contracts';
export class ReorderProductsDto implements ReorderProductsRequest {
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  categoryId!: string | null;
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
