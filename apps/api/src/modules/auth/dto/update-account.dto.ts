import {
  ACCOUNT_LIMITS,
  REGISTRATION_LIMITS,
  type UpdateProfileRequest,
  type ChangeEmailRequest,
  type ChangePasswordRequest,
} from '@paserve/contracts';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateProfileDto implements UpdateProfileRequest {
  @Transform(trim)
  @IsString()
  @MaxLength(ACCOUNT_LIMITS.nameMax)
  @Matches(/^[^\p{Cc}]*$/u, {
    message: 'Names cannot contain control characters.',
  })
  firstName!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(ACCOUNT_LIMITS.nameMax)
  @Matches(/^[^\p{Cc}]*$/u, {
    message: 'Names cannot contain control characters.',
  })
  lastName!: string;
}

class CurrentPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(REGISTRATION_LIMITS.passwordMax)
  currentPassword!: string;
}

export class ChangeEmailDto
  extends CurrentPasswordDto
  implements ChangeEmailRequest
{
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(REGISTRATION_LIMITS.emailMax)
  email!: string;
}

export class ChangePasswordDto
  extends CurrentPasswordDto
  implements ChangePasswordRequest
{
  @IsString()
  @Matches(/\S/u, { message: 'Password must include a non-space character.' })
  @MinLength(REGISTRATION_LIMITS.passwordMin)
  @MaxLength(REGISTRATION_LIMITS.passwordMax)
  password!: string;
}
