import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { ShopMemberRequest } from './shop-membership.guard.js';
import { invalidSession } from '../../auth/tokens.service.js';
import { ShopMembersService } from '../shop-members.service.js';
import { trackRequestWork } from '../../../common/load-shedding/request-work.js';

/** Apply after JwtAuthGuard to operations reserved for the requested shop's owner. */
@Injectable()
export class ShopOwnerGuard implements CanActivate {
  constructor(private readonly memberships: ShopMembersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ShopMemberRequest>();
    if (!request.user?.id) throw invalidSession();
    const shopId = request.params.shopId;
    request.shopMembership = await trackRequestWork(request, () =>
      this.memberships.requireOwner(
        request.user.id,
        typeof shopId === 'string' ? shopId : '',
      ),
    );
    return true;
  }
}
