import { CATALOG_NAME_PATTERN, normalizeCatalogName } from '@paserve/contracts';
import {
  CATEGORY_LIMITS,
  type UpdateCategoryRequest,
} from '@paserve/contracts';
import { Transform } from 'class-transformer';
import {
  IsString,
  MinLength,
  MaxLength,
  Matches,
  ValidateIf,
} from 'class-validator';
export class UpdateCategoryDto implements UpdateCategoryRequest {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeCatalogName(value, true) : value,
  )
  @IsString({ message: 'Enter a category name.' })
  @MinLength(1, { message: 'Enter a category name.' })
  @MaxLength(CATEGORY_LIMITS.nameMax)
  @Matches(CATALOG_NAME_PATTERN, {
    message: 'Use a category name without control characters.',
  })
  name?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Enter a description or leave it blank.' })
  @MaxLength(CATEGORY_LIMITS.descriptionMax)
  description?: string;
}
