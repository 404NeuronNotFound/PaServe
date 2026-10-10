import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  ADD_ON_LIMITS,
  CUSTOMER_NOTE_MAX_LENGTH,
  CUSTOMER_NOTE_PATTERN,
  normalizeCustomerNote,
  PRODUCT_PRICE_PATTERN,
  type CreateAddOnRequest,
  type UpdateAddOnRequest,
  type AssignProductAddOnRequest,
  type AddOnSelectionRequest,
  type CreateExtraShotRequest,
  type CreateOatMilkRequest,
} from '@paserve/contracts';

const normalize = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const optional = (_object: unknown, value: unknown) => value !== undefined;
class AddOnFieldsDto {
  @ValidateIf(optional)
  @IsBoolean()
  isAvailable?: boolean;

  @ValidateIf(optional)
  @IsInt()
  @Min(0)
  @Max(ADD_ON_LIMITS.sortOrderMax)
  sortOrder?: number;
}
export class CreateAddOnDto
  extends AddOnFieldsDto
  implements CreateAddOnRequest
{
  @Transform(normalize)
  @IsString()
  @MinLength(1)
  @MaxLength(ADD_ON_LIMITS.nameMax)
  @Matches(/^[^\p{Cc}\p{Cs}]*$/u)
  name!: string;

  @IsString()
  @Matches(PRODUCT_PRICE_PATTERN)
  priceAdjustment!: string;
}
export class UpdateAddOnDto
  extends AddOnFieldsDto
  implements UpdateAddOnRequest
{
  @ValidateIf(optional)
  @Transform(normalize)
  @IsString()
  @MinLength(1)
  @MaxLength(ADD_ON_LIMITS.nameMax)
  @Matches(/^[^\p{Cc}\p{Cs}]*$/u)
  name?: string;

  @ValidateIf(optional)
  @IsString()
  @Matches(PRODUCT_PRICE_PATTERN)
  priceAdjustment?: string;
}
class PricedAddOnPresetDto {
  @IsString()
  @Matches(PRODUCT_PRICE_PATTERN)
  priceAdjustment!: string;

  @ValidateIf(optional)
  @IsInt()
  @Min(0)
  @Max(ADD_ON_LIMITS.sortOrderMax)
  sortOrder?: number;
}
export class CreateExtraShotDto
  extends PricedAddOnPresetDto
  implements CreateExtraShotRequest {}
export class CreateOatMilkDto
  extends PricedAddOnPresetDto
  implements CreateOatMilkRequest {}
export class AssignProductAddOnDto implements AssignProductAddOnRequest {
  @IsUUID('4')
  addOnId!: string;
}
export class AddOnSelectionDto implements AddOnSelectionRequest {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeCustomerNote(value) : value,
  )
  @ValidateIf(optional)
  @IsString()
  @MaxLength(CUSTOMER_NOTE_MAX_LENGTH)
  @Matches(CUSTOMER_NOTE_PATTERN)
  notes?: string;

  @IsArray()
  @ArrayMaxSize(ADD_ON_LIMITS.selectionMax)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  addOnIds!: string[];
}
