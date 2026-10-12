import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PUBLIC_TABLE_CODE_PATTERN } from '@paserve/contracts';
import { ProductSelectionDto } from '../products/public-product.dto.js';

export class OrderLineDto extends ProductSelectionDto {
  @IsUUID('4')
  productId!: string;
}
export class CreateDineInOrderDto {
  @IsUUID('4')
  requestId!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['DINE_IN'])
  mode?: 'DINE_IN';

  @IsString()
  @Matches(PUBLIC_TABLE_CODE_PATTERN)
  tableCode!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items!: OrderLineDto[];
}
