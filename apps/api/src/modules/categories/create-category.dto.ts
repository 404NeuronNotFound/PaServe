import { CATALOG_NAME_PATTERN, normalizeCatalogName } from '@paserve/contracts';
import {
  CATEGORY_LIMITS,
  type CreateCategoryRequest,
} from '@paserve/contracts';
import { Transform } from 'class-transformer';
import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class CreateCategoryDto implements CreateCategoryRequest {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeCatalogName(value, true) : value,
  )
  @IsString({ message: 'Enter a category name.' })
  @MinLength(1, { message: 'Enter a category name.' })
  @MaxLength(CATEGORY_LIMITS.nameMax)
  @Matches(CATALOG_NAME_PATTERN, {
    message: 'Use a category name without control characters.',
  })
  name!: string;
}
