import { SHOP_LIMITS, type CreateShopRequest } from '@paserve/contracts';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateShopDto implements CreateShopRequest {
  @Transform(trim)
  @IsString({ message: 'Enter your shop name.' })
  @MinLength(1, { message: 'Enter your shop name.' })
  @MaxLength(SHOP_LIMITS.nameMax)
  name!: string;

  @Transform(trim)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: 'Enter a description or leave it blank.' })
  @MaxLength(SHOP_LIMITS.descriptionMax)
  description?: string;
}
