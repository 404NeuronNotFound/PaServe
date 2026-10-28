import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { UserMembership } from '@paserve/contracts';
import type { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard.js';
import { invalidSession } from '../../auth/tokens.service.js';
import { ShopMembersService } from '../shop-members.service.js';
import { trackRequestWork } from '../../../common/load-shedding/request-work.js';

export interface ShopMemberRequest extends AuthenticatedRequest {
  shopMembership: UserMembership;
}

/** Apply after JwtAuthGuard on shop-scoped routes using a :shopId parameter. */
@Injectable()
export class ShopMembershipGuard implements CanActivate {
  constructor(private readonly memberships: ShopMembersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ShopMemberRequest>();
    if (!request.user?.id) throw invalidSession();
    const shopId = request.params.shopId;
    request.shopMembership = await trackRequestWork(request, () =>
      this.memberships.requireMembership(
        request.user.id,
        typeof shopId === 'string' ? shopId : '',
      ),
    );
    return true;
  }
}
