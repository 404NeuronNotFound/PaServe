import { REGISTRATION_LIMITS, type RegisterRequest } from '@paserve/contracts';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto implements RegisterRequest {
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
