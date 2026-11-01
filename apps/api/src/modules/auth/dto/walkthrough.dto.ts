import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { WalkthroughCompletionRequest } from '@paserve/contracts';
export class WalkthroughCompletionDto implements WalkthroughCompletionRequest {
  @IsIn(['account', 'places', 'shop'])
  kind!: 'account' | 'places' | 'shop';
  @IsOptional()
  @IsUUID()
  shopId?: string;
  @IsIn(['completed', 'skipped'])
  outcome!: 'completed' | 'skipped';
}
