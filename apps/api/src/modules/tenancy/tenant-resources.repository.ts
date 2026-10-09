import { BadRequestException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from './shop-scope.js';

export type TenantResourceKind = 'product' | 'category';

@Injectable()
export class TenantResourcesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findResource(
    userId: string,
    shopId: string,
    kind: TenantResourceKind,
    resourceId: string,
  ) {
    if (!['product', 'category'].includes(kind) || !isUUID(resourceId))
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
    if (kind === 'product')
      return this.prisma.product.findFirst({ where, select });
    return this.prisma.category.findFirst({ where, select });
  }
}
