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
  CUSTOMER_NOTE_MAX_LENGTH,
  CUSTOMER_NOTE_PATTERN,
  normalizeCustomerNote,
  type ProductSelectionRequest,
} from '@paserve/contracts';

export class ProductSelectionDto implements ProductSelectionRequest {
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  variantIds!: string[];

  @IsArray()
  @ArrayMaxSize(ADD_ON_LIMITS.selectionMax)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  addOnIds!: string[];

  @IsInt()
  @Min(1)
  @Max(99)
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
