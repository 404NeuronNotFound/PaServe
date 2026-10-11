import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';

const roles = ['OWNER', 'ADMIN'] as const;
const tableSelect = {
  id: true,
  shopId: true,
  number: true,
  code: true,
  isActive: true,
  createdAt: true,
} as const;

@Injectable()
export class TablesRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, shopId: string, number: string, code: string) {
    // Conditional parent write repeats live access atomically with child creation.
    return this.prisma.shop.update({
      where: shopAccessWhere(userId, shopId, roles),
      data: { tables: { create: { number, code } } },
      select: { tables: { where: { shopId, number }, select: tableSelect } },
    });
  }

  list(userId: string, shopId: string) {
    return this.prisma.shop.findFirst({
      where: shopAccessWhere(userId, shopId, roles),
      select: {
        tables: {
          where: { shopId },
          select: tableSelect,
          orderBy: [{ number: 'asc' }, { id: 'asc' }],
        },
      },
    });
  }
}
