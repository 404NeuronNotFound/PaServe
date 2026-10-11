import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class PublicProductRepository {
  constructor(private readonly prisma: PrismaService) {}
  async read(slug: string, productId: string) {
    const shop = await this.prisma.shop.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
    });
    if (!shop) return null;
    const orderBy = [
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ] as const;
    return this.prisma.product.findFirst({
      where: {
        id: productId,
        shopId: shop.id,
        isArchived: false,
        status: { in: ['AVAILABLE', 'SOLD_OUT'] },
        shop: { id: shop.id, slug, isActive: true },
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
        featuredSortOrder: true,
        sortOrder: true,
        optionGroups: {
          where: { shopId: shop.id, productId, isAvailable: true },
          select: { id: true, name: true, isRequired: true },
          orderBy: [...orderBy],
        },
        variants: {
          where: {
            shopId: shop.id,
            productId,
            isAvailable: true,
            OR: [
              { optionGroupId: null },
              {
                optionGroup: { shopId: shop.id, productId, isAvailable: true },
              },
            ],
          },
          select: {
            id: true,
            optionGroupId: true,
            name: true,
            priceAdjustment: true,
            isDefault: true,
          },
          orderBy: [...orderBy],
        },
        addOns: {
          where: {
            shopId: shop.id,
            productId,
            addOn: { shopId: shop.id, isAvailable: true },
          },
          select: {
            addOn: { select: { id: true, name: true, priceAdjustment: true } },
          },
          orderBy: [{ addOn: { sortOrder: 'asc' } }, { addOnId: 'asc' }],
        },
      },
    });
  }
}
