import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { PublicTableContext } from '@paserve/contracts';

@Injectable()
export class PublicTablesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    shopSlug: string,
    code: string,
  ): Promise<PublicTableContext | null> {
    const table = await this.prisma.restaurantTable.findFirst({
      where: { code, isActive: true, shop: { slug: shopSlug, isActive: true } },
      select: { code: true, number: true, shop: { select: { slug: true } } },
    });
    return table
      ? { shopSlug: table.shop.slug, code: table.code, number: table.number }
      : null;
  }
}
