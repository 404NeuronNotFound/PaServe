import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  ADD_ON_LIMITS,
  ORDER_INPUT_LIMITS,
  CUSTOMER_NOTE_MAX_LENGTH,
  CUSTOMER_NOTE_PATTERN,
  normalizeCustomerNote,
  type ProductSelectionRequest,
} from '@paserve/contracts';

export class ProductSelectionDto implements ProductSelectionRequest {
  @IsArray()
  @ArrayMaxSize(ORDER_INPUT_LIMITS.variantsMax)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  variantIds!: string[];

  @IsArray()
  @ArrayMaxSize(ADD_ON_LIMITS.selectionMax)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  addOnIds!: string[];

  @IsInt()
  @Min(ORDER_INPUT_LIMITS.quantityMin)
  @Max(ORDER_INPUT_LIMITS.quantityMax)
  quantity!: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeCustomerNote(value) : value,
  )
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(CUSTOMER_NOTE_MAX_LENGTH)
  @Matches(CUSTOMER_NOTE_PATTERN)
  notes?: string;
}
