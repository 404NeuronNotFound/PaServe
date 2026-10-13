import { Equals, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  PAYMENT_REFERENCE_PATTERN,
  type ManualGcashPaymentRequest,
} from '@paserve/contracts';

export class ManualGcashPaymentDto implements ManualGcashPaymentRequest {
  @IsUUID()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  requestId!: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$(?![\s\S])/)
  reviewVersion!: string;

  @Equals(true)
  receivedConfirmed!: true;

  @IsOptional()
  @IsString()
  @Matches(PAYMENT_REFERENCE_PATTERN)
  reference?: string | null;
}
