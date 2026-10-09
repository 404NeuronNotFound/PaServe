import {
  applyDecorators,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { invalidSession } from '../auth/tokens.service.js';
import type { ShopMemberRequest } from '../shop-members/guards/shop-membership.guard.js';
import type { TenantResourceKind } from './tenant-resources.repository.js';
import { TenantResourcesService } from './tenant-resources.service.js';

const resourceKey = 'paserve:shop-resource';
type ResourcePolicy = { kind: TenantResourceKind; parameter: string };
export interface ShopResourceRequest extends ShopMemberRequest {
  shopResource: { id: string; shopId: string; kind: TenantResourceKind };
}

@Injectable()
export class ShopResourceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resources: TenantResourcesService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ShopResourceRequest>();
    if (!request.user?.id) throw invalidSession();
    const policy = this.reflector.getAllAndOverride<ResourcePolicy>(
      resourceKey,
      [context.getHandler(), context.getClass()],
    );
    if (
      !policy ||
      !['product', 'category'].includes(policy.kind) ||
      !policy.parameter ||
      policy.parameter === 'shopId'
    )
      throw new ForbiddenException({
        code: 'RESOURCE_POLICY_REQUIRED',
        message: 'This action has no valid resource policy.',
      });
    const shopId = request.params.shopId;
    const resourceId = request.params[policy.parameter];
    const result = await this.resources.requireResource(
      request.user.id,
      typeof shopId === 'string' ? shopId : '',
      policy.kind,
      typeof resourceId === 'string' ? resourceId : '',
    );
    request.shopMembership = result.membership;
    request.shopResource = result.resource;
    return true;
  }
}

/** Authentication, live membership, then resource ownership for route IDs. */
export function ShopResource(kind: TenantResourceKind, parameter: string) {
  return applyDecorators(
    SetMetadata(resourceKey, Object.freeze({ kind, parameter })),
    UseGuards(JwtAuthGuard, ShopResourceGuard),
  );
}
