import { Transform } from 'class-transformer';
import {
  Equals,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  CASH_AMOUNT_PATTERN,
  PAYMENT_REFERENCE_PATTERN,
  type CreatePaymentRequest,
} from '@paserve/contracts';

export class CreatePaymentDto implements CreatePaymentRequest {
  @IsUUID()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  requestId!: string;
  @IsString()
  @Matches(/^[a-f0-9]{64}$(?![\s\S])/)
  reviewVersion!: string;
  @IsIn(['CASH', 'GCASH_MANUAL', 'CARD_MANUAL', 'OTHER'])
  method!: CreatePaymentRequest['method'];
  @ValidateIf((o: CreatePaymentDto) => o.orderNumber === undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  qrToken?: string;
  @ValidateIf((o: CreatePaymentDto) => o.qrToken === undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^ORD-\d{6,19}$(?![\s\S])/)
  orderNumber?: string;
  @ValidateIf((o: CreatePaymentDto) => o.method === 'CASH')
  @IsString()
  @Matches(CASH_AMOUNT_PATTERN)
  amountReceived?: string;
  @ValidateIf((o: CreatePaymentDto) => o.method !== 'CASH')
  @Equals(true)
  receivedConfirmed?: true;
  @IsOptional()
  @IsString()
  @Matches(PAYMENT_REFERENCE_PATTERN)
  reference?: string | null;
  @ValidateIf((o: CreatePaymentDto) => o.method === 'OTHER')
  @IsString()
  @Matches(/^[^\p{Cc}\p{Cf}<>]{1,80}$(?![\s\S])/u)
  description?: string;
}
