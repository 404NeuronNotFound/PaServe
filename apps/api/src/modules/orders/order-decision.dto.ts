import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  CUSTOMER_NOTE_PATTERN,
  type OrderDecisionRequest,
  type RejectOrderRequest,
} from '@paserve/contracts';
import { VerifyOrderQrDto } from './verify-order-qr.dto.js';

export class OrderDecisionDto
  extends VerifyOrderQrDto
  implements OrderDecisionRequest
{
  @IsString()
  @Matches(/^[a-f0-9]{64}$(?![\s\S])/)
  reviewVersion!: string;
}
export class RejectOrderDto
  extends OrderDecisionDto
  implements RejectOrderRequest
{
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(300)
  @Matches(CUSTOMER_NOTE_PATTERN)
  rejectionReason?: string;
}
