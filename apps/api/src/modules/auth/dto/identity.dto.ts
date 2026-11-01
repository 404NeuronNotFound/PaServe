import {
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { RegistrationNameDto } from './register.dto.js';
export class EmailCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  challengeToken?: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
export class GoogleLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  credential!: string;
  @IsOptional()
  @IsBoolean()
  keepSignedIn?: boolean;
}
export class GoogleRegisterDto extends RegistrationNameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  credential!: string;
}
