import { IsBoolean } from 'class-validator';
import type { SetCategoryVisibilityRequest } from '@paserve/contracts';

export class CategoryVisibilityDto implements SetCategoryVisibilityRequest {
  @IsBoolean()
  isVisible!: boolean;

  @IsBoolean()
  expectedVisibility!: boolean;
}
