import { Transform } from 'class-transformer';
import {
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
  PRODUCT_PRICE_PATTERN,
  PRODUCT_VARIANT_LIMITS,
  type CreateProductOptionGroupRequest,
  type CreateProductVariantRequest,
  type UpdateProductOptionGroupRequest,
  type UpdateProductVariantRequest,
  type CreateRegularVariantRequest,
} from '@paserve/contracts';

const normalize = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const optional = (_object: unknown, value: unknown) => value !== undefined;

class ChoiceFieldsDto {
  @ValidateIf(optional)
  @IsBoolean()
  isAvailable?: boolean;

  @ValidateIf(optional)
  @IsInt()
  @Min(0)
  @Max(PRODUCT_VARIANT_LIMITS.sortOrderMax)
  sortOrder?: number;
}
class GroupFieldsDto extends ChoiceFieldsDto {
  @ValidateIf(optional)
  @IsBoolean()
  isRequired?: boolean;
}
class VariantFieldsDto extends ChoiceFieldsDto {
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID('4')
  optionGroupId?: string | null;

  @ValidateIf(optional)
  @IsBoolean()
  isDefault?: boolean;
}
export class CreateRegularVariantDto implements CreateRegularVariantRequest {
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID('4')
  optionGroupId?: string | null;

  @ValidateIf(optional)
  @IsInt()
  @Min(0)
  @Max(PRODUCT_VARIANT_LIMITS.sortOrderMax)
  sortOrder?: number;
}
export class CreateProductOptionGroupDto
  extends GroupFieldsDto
  implements CreateProductOptionGroupRequest
{
  @Transform(normalize)
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_VARIANT_LIMITS.nameMax)
  @Matches(/^\P{Cc}*$/u)
  name!: string;
}
export class UpdateProductOptionGroupDto
  extends GroupFieldsDto
  implements UpdateProductOptionGroupRequest
{
  @ValidateIf(optional)
  @Transform(normalize)
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_VARIANT_LIMITS.nameMax)
  @Matches(/^\P{Cc}*$/u)
  name?: string;
}
export class CreateProductVariantDto
  extends VariantFieldsDto
  implements CreateProductVariantRequest
{
  @Transform(normalize)
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_VARIANT_LIMITS.nameMax)
  @Matches(/^\P{Cc}*$/u)
  name!: string;

  @IsString()
  @Matches(PRODUCT_PRICE_PATTERN)
  priceAdjustment!: string;
}
export class UpdateProductVariantDto
  extends VariantFieldsDto
  implements UpdateProductVariantRequest
{
  @ValidateIf(optional)
  @Transform(normalize)
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_VARIANT_LIMITS.nameMax)
  @Matches(/^\P{Cc}*$/u)
  name?: string;

  @ValidateIf(optional)
  @IsString()
  @Matches(PRODUCT_PRICE_PATTERN)
  priceAdjustment?: string;
}
