import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type {
  CurrentUser,
  WalkthroughCompletionRequest,
  WalkthroughProgressResponse,
} from '@paserve/contracts';
import {
  SHOP_WALKTHROUGH_PAGES,
  canAccessWalkthroughPage,
  WALKTHROUGH_VERSION,
} from '@paserve/contracts';
import { PrismaService } from '../../database/prisma.service.js';
@Injectable()
export class WalkthroughService {
  constructor(private readonly prisma: PrismaService) {}
  async progress(userId: string): Promise<WalkthroughProgressResponse> {
    const rows = await this.prisma.walkthroughProgress.findMany({
      where: { userId, version: WALKTHROUGH_VERSION },
      select: { scope: true },
      take: 1000,
    });
    return { completedScopes: rows.map((row) => row.scope) };
  }
  async complete(user: CurrentUser, input: WalkthroughCompletionRequest) {
    if (
      input.page &&
      (input.kind !== 'shop' || !SHOP_WALKTHROUGH_PAGES.includes(input.page))
    )
      throw new BadRequestException('Choose a valid shop page walkthrough.');
    let scope = input.kind === 'places' ? 'places' : 'account';
    if (input.kind === 'shop') {
      const membership = user.memberships.find(
        (item) => item.shopId === input.shopId && item.shop.isActive,
      );
      if (!membership)
        throw new ForbiddenException('This workspace is unavailable.');
      // Role and membership come from the live authenticated account, never the body.
      scope = 'shop:' + membership.shopId + ':' + membership.role;
      if (input.page) {
        if (!canAccessWalkthroughPage(membership.role, input.page))
          throw new ForbiddenException(
            'This guide is unavailable for your role.',
          );
        scope += ':page:' + input.page;
      }
    } else if (input.shopId)
      throw new BadRequestException('Choose an account or shop walkthrough.');
    await this.prisma.walkthroughProgress.upsert({
      where: {
        userId_scope_version: {
          userId: user.id,
          scope,
          version: WALKTHROUGH_VERSION,
        },
      },
      create: {
        userId: user.id,
        scope,
        version: WALKTHROUGH_VERSION,
        outcome: input.outcome,
      },
      update: { outcome: input.outcome, completedAt: new Date() },
    });
    return { scope };
  }
}
