import { BadRequestException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from './shop-scope.js';

export const TENANT_RESOURCE_KINDS = [
  'product',
  'category',
  'addOn',
  'table',
  'order',
  'orderItem',
] as const;
export type TenantResourceKind = (typeof TENANT_RESOURCE_KINDS)[number];

@Injectable()
export class TenantResourcesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findResource(
    userId: string,
    shopId: string,
    kind: TenantResourceKind,
    resourceId: string,
  ) {
    if (!TENANT_RESOURCE_KINDS.includes(kind) || !isUUID(resourceId))
      throw new BadRequestException({
        code: 'INVALID_RESOURCE_ID',
        message: 'Enter a valid shop resource identifier.',
      });
    const where = {
      id: resourceId,
      shopId,
      shop: shopAccessWhere(userId, shopId),
    };
    const select = { id: true, shopId: true } as const;
    if (kind === 'orderItem')
      return this.prisma.orderItem.findFirst({
        where: { id: resourceId, shopId, order: { shopId, shop: where.shop } },
        select,
      });
    if (kind === 'product')
      return this.prisma.product.findFirst({ where, select });
    if (kind === 'addOn') return this.prisma.addOn.findFirst({ where, select });
    if (kind === 'table')
      return this.prisma.restaurantTable.findFirst({ where, select });
    if (kind === 'order') return this.prisma.order.findFirst({ where, select });
    return this.prisma.category.findFirst({ where, select });
  }
}
