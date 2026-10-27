import type { LoginRequest } from '@paserve/contracts';
import { REGISTRATION_LIMITS } from '@paserve/contracts';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  ValidateIf,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto implements LoginRequest {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  challengeToken?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  keepSignedIn?: boolean;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(REGISTRATION_LIMITS.emailMax)
  email!: string;

  @IsString({ message: 'Enter your password.' })
  @MinLength(1, { message: 'Enter your password.' })
  @MaxLength(REGISTRATION_LIMITS.passwordMax)
  password!: string;
}
