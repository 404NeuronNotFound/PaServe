import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ORDER_INPUT_LIMITS,
  PUBLIC_TABLE_CODE_PATTERN,
} from '@paserve/contracts';
import { ProductSelectionDto } from '../products/public-product.dto.js';

export class OrderLineDto extends ProductSelectionDto {
  @IsUUID('4')
  productId!: string;
}
export class CreateOrderDto {
  @IsUUID('4')
  requestId!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['DINE_IN', 'TAKEOUT'])
  mode?: 'DINE_IN' | 'TAKEOUT';

  @ValidateIf(
    (object: CreateOrderDto, value) =>
      object.mode !== 'TAKEOUT' || value !== undefined,
  )
  @IsString()
  @Matches(PUBLIC_TABLE_CODE_PATTERN)
  tableCode?: string;

  @ValidateIf(
    (object: CreateOrderDto, value) =>
      object.mode !== 'TAKEOUT' || value !== undefined,
  )
  @IsString()
  @MaxLength(1024)
  @Matches(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
  tableToken?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ORDER_INPUT_LIMITS.linesMax)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items!: OrderLineDto[];
}
