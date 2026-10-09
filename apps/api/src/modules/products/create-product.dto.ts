import { Transform } from 'class-transformer';
import {
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsUUID,
  IsIn,
  IsBoolean,
  IsInt,
  Min,
  Max,
  ValidateIf,
  ValidateBy,
} from 'class-validator';
import {
  PRODUCT_LIMITS,
  PRODUCT_PRICE_PATTERN,
  PRODUCT_STATUSES,
  isValidProductImageUrl,
  type CreateProductRequest,
  type ProductStatus,
} from '@paserve/contracts';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class CreateProductDto implements CreateProductRequest {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_LIMITS.nameMax)
  @Matches(/^\P{Cc}*$/u)
  name!: string;

  @IsString()
  @Matches(PRODUCT_PRICE_PATTERN, {
    message: 'Use a price from 0 to 99999999.99 with up to two decimal places.',
  })
  price!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  categoryId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(PRODUCT_LIMITS.descriptionMax)
  description?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(PRODUCT_LIMITS.imageUrlMax)
  @ValidateBy({
    name: 'productImageUrl',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' &&
        (value === '' || isValidProductImageUrl(value)),
      defaultMessage: () => 'Use an HTTPS image URL without credentials.',
    },
  })
  imageUrl?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isFeatured?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(PRODUCT_LIMITS.sortOrderMax)
  sortOrder?: number;
}
