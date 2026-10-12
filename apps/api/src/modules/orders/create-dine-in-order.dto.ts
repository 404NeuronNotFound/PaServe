import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
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

  @IsString()
  @MaxLength(1024)
  @Matches(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
  tableToken!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items!: OrderLineDto[];
}
