import { IsString, IsUUID, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  CASH_AMOUNT_PATTERN,
  type CashPaymentRequest,
} from '@paserve/contracts';

export class CashPaymentDto implements CashPaymentRequest {
  @IsUUID()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  requestId!: string;
  @IsString()
  @Matches(/^[a-f0-9]{64}$(?![\s\S])/)
  reviewVersion!: string;
  @IsString()
  @Matches(CASH_AMOUNT_PATTERN)
  amountReceived!: string;
}
