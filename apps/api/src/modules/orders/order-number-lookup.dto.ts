import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, IsOptional } from 'class-validator';
import {
  CUSTOMER_NOTE_PATTERN,
  type LookupOrderNumberRequest,
  type OrderNumberDecisionRequest,
  type RejectOrderNumberRequest,
} from '@paserve/contracts';

export class LookupOrderNumberDto implements LookupOrderNumberRequest {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^ORD-\d{6,19}$(?![\s\S])/)
  orderNumber!: string;
}
export class OrderNumberDecisionDto
  extends LookupOrderNumberDto
  implements OrderNumberDecisionRequest
{
  @IsString()
  @Matches(/^[a-f0-9]{64}$(?![\s\S])/)
  reviewVersion!: string;
}
export class RejectOrderNumberDto
  extends OrderNumberDecisionDto
  implements RejectOrderNumberRequest
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
