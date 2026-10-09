import {
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';
import {
  CATEGORY_REORDER_MAX,
  type ReorderCategoriesRequest,
} from '@paserve/contracts';

export class ReorderCategoriesDto implements ReorderCategoriesRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CATEGORY_REORDER_MAX)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  categoryIds!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CATEGORY_REORDER_MAX)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  expectedOrder!: string[];
}
