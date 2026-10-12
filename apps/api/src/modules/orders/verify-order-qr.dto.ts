import { IsString, MaxLength, MinLength } from 'class-validator';
import type { VerifyOrderQrRequest } from '@paserve/contracts';

export class VerifyOrderQrDto implements VerifyOrderQrRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  qrToken!: string;
}
