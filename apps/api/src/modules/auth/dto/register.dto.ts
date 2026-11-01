import {
  ACCOUNT_LIMITS,
  REGISTRATION_LIMITS,
  type RegisterRequest,
} from '@paserve/contracts';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class RegistrationNameDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(ACCOUNT_LIMITS.nameMax)
  @Matches(/^[^\p{Cc}]*$/u)
  firstName!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(ACCOUNT_LIMITS.nameMax)
  @Matches(/^[^\p{Cc}]*$/u)
  lastName!: string;
}

export class RegisterDto
  extends RegistrationNameDto
  implements RegisterRequest
{
  @IsString()
  @Matches(/^\d{6,8}$/u)
  verificationCode!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  challengeToken?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(REGISTRATION_LIMITS.emailMax)
  email!: string;

  @IsString({ message: 'Enter a password.' })
  @Matches(/\S/u, { message: 'Password must include a non-space character.' })
  @MinLength(REGISTRATION_LIMITS.passwordMin, {
    message: `Use at least ${REGISTRATION_LIMITS.passwordMin} characters.`,
  })
  @MaxLength(REGISTRATION_LIMITS.passwordMax, {
    message: `Use no more than ${REGISTRATION_LIMITS.passwordMax} characters.`,
  })
  password!: string;
}
