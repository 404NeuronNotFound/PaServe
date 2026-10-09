import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class PublicMenuRepository {
  constructor(private readonly prisma: PrismaService) {}
  async read(slug: string) {
    // Public slugs resolve only active shops. All child queries repeat the resolved tenant.
    const shop = await this.prisma.shop.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
    });
    if (!shop) return null;
    return this.prisma.shop.findFirst({
      where: { id: shop.id, slug, isActive: true },
      select: {
        name: true,
        slug: true,
        description: true,
        categories: {
          where: { shopId: shop.id, isVisible: true },
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            sortOrder: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        },
        products: {
          where: {
            shopId: shop.id,
            status: { in: ['AVAILABLE', 'SOLD_OUT'] },
            OR: [
              { categoryId: null },
              { category: { shopId: shop.id, isVisible: true } },
            ],
          },
          select: {
            id: true,
            categoryId: true,
            name: true,
            slug: true,
            description: true,
            price: true,
            imageUrl: true,
            status: true,
            isFeatured: true,
            sortOrder: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
  }
}
