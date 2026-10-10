import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import {
  TenantResourcesRepository,
  TENANT_RESOURCE_KINDS,
  type TenantResourceKind,
} from './tenant-resources.repository.js';

@Injectable()
export class TenantResourcesService {
  constructor(
    private readonly memberships: ShopMembersService,
    private readonly repository: TenantResourcesRepository,
  ) {}

  async requireResource(
    userId: string,
    shopId: string,
    kind: TenantResourceKind,
    resourceId: string,
  ) {
    // Membership first: knowing a valid resource ID never grants access to its shop.
    const membership = await this.memberships.requireMembership(userId, shopId);
    if (!TENANT_RESOURCE_KINDS.includes(kind) || !isUUID(resourceId))
      throw new BadRequestException({
        code: 'INVALID_RESOURCE_ID',
        message: 'Enter a valid shop resource identifier.',
      });
    const resource = await this.repository.findResource(
      userId,
      shopId,
      kind,
      resourceId,
    );
    if (!resource)
      throw new NotFoundException({
        code: 'RESOURCE_NOT_ACCESSIBLE',
        message:
          'This resource is unavailable or does not belong to this shop.',
      });
    return { membership, resource: { ...resource, kind } };
  }
}
