import { IsBoolean } from 'class-validator';
import type { ProductArchiveRequest } from '@paserve/contracts';
export class ProductArchiveDto implements ProductArchiveRequest {
  @IsBoolean()
  isArchived!: boolean;
  @IsBoolean()
  expectedArchived!: boolean;
}
