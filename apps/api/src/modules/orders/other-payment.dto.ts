import { IsString, Matches } from 'class-validator';
import type { OtherPaymentRequest } from '@paserve/contracts';
import { ManualGcashPaymentDto } from './manual-gcash-payment.dto.js';

export class OtherPaymentDto
  extends ManualGcashPaymentDto
  implements OtherPaymentRequest
{
  @IsString()
  @Matches(/^[^\p{Cc}\p{Cf}<>]{1,80}$(?![\s\S])/u)
  description!: string;
}
