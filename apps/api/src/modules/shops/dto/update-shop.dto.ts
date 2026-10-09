import {
  SHOP_LIMITS,
  SHOP_SETTINGS_LIMITS,
  isValidShopPhone,
  SHOP_PHONE_HINT,
  type UpdateShopRequest,
} from '@paserve/contracts';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsUrl,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateBy,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateShopDto implements UpdateShopRequest {
  @Transform(trim)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: 'Enter your shop name.' })
  @MinLength(1, { message: 'Enter your shop name.' })
  @MaxLength(SHOP_LIMITS.nameMax)
  name?: string;

  @Transform(trim)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: 'Enter a description or leave it blank.' })
  @MaxLength(SHOP_LIMITS.descriptionMax)
  description?: string;

  @Transform(trim)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(SHOP_SETTINGS_LIMITS.displayName)
  displayName?: string;

  @Transform(trim)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(SHOP_SETTINGS_LIMITS.phone)
  @ValidateBy({
    name: 'shopPhone',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && isValidShopPhone(value),
      defaultMessage: () => SHOP_PHONE_HINT,
    },
  })
  phone?: string;

  @Transform(trim)
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== '')
  @IsEmail({}, { message: 'Enter a valid contact email or leave it blank.' })
  @MaxLength(SHOP_SETTINGS_LIMITS.contactEmail)
  contactEmail?: string;

  @Transform(trim)
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== '')
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      disallow_auth: true,
    },
    {
      message:
        'Enter a full http:// or https:// website address or leave it blank.',
    },
  )
  @MaxLength(SHOP_SETTINGS_LIMITS.website)
  website?: string;

  @Transform(trim)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(SHOP_SETTINGS_LIMITS.address)
  address?: string;

  @Transform(trim)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(SHOP_SETTINGS_LIMITS.operatingHours)
  operatingHours?: string;
}
