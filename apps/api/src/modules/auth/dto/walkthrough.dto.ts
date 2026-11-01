import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  SHOP_WALKTHROUGH_PAGES,
  type ShopWalkthroughPage,
  type WalkthroughCompletionRequest,
} from '@paserve/contracts';
export class WalkthroughCompletionDto implements WalkthroughCompletionRequest {
  @IsIn(['account', 'places', 'shop'])
  kind!: 'account' | 'places' | 'shop';
  @IsOptional()
  @IsUUID()
  shopId?: string;
  @IsOptional()
  @IsIn(SHOP_WALKTHROUGH_PAGES)
  page?: ShopWalkthroughPage;
  @IsIn(['completed', 'skipped'])
  outcome!: 'completed' | 'skipped';
}
