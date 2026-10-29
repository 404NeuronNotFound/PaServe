import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { BadRequestException } from '@nestjs/common';
import { ORDER_INPUT_LIMITS } from '@paserve/contracts';
import { isUUID } from 'class-validator';

@Injectable()
export class PublicProductRepository {
  constructor(private readonly prisma: PrismaService) {}
  async read(
    slug: string,
    productId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const shop = await db.shop.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
    });
    if (!shop) return null;
    return db.product.findFirst(this.productArgs(slug, shop.id, productId));
  }

  async readMany(
    slug: string,
    productIds: string[],
    db: Prisma.TransactionClient = this.prisma,
  ) {
    if (
      !Array.isArray(productIds) ||
      !productIds.length ||
      productIds.length > ORDER_INPUT_LIMITS.linesMax ||
      productIds.some((id) => typeof id !== 'string' || !isUUID(id))
    )
      throw new BadRequestException({
        code: 'PRODUCT_SELECTION_INVALID',
        message: 'Choose a bounded list of valid products.',
      });
    const ids = [...new Set(productIds)];
    const shop = await db.shop.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
    });
    if (!shop) return [];
    return db.product.findMany({
      ...this.pricingArgs(slug, shop.id, { in: ids }),
      take: ids.length,
    });
  }

  async readPricing(
    slug: string,
    productId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const shop = await db.shop.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
    });
    if (!shop) return null;
    return db.product.findFirst(this.pricingArgs(slug, shop.id, productId));
  }

  private pricingArgs(
    slug: string,
    shopId: string,
    productId: string | { in: string[] },
  ) {
    const args = this.productArgs(slug, shopId, productId);
    return {
      ...args,
      // Checkout does not need images, descriptions, display ordering or group
      // names. Keep modifier fields that become immutable receipt snapshots.
      select: {
        id: true,
        name: true,
        price: true,
        status: true,
        optionGroups: {
          ...args.select.optionGroups,
          select: { id: true, isRequired: true },
        },
        variants: args.select.variants,
        addOns: args.select.addOns,
      },
    } satisfies Prisma.ProductFindManyArgs;
  }

  private productArgs(
    slug: string,
    shopId: string,
    productId: string | { in: string[] },
  ) {
    const orderBy = [
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ] as const;
    return {
      where: {
        id: productId,
        shopId,
        isArchived: false,
        status: { in: ['AVAILABLE', 'SOLD_OUT'] },
        shop: { id: shopId, slug, isActive: true },
        OR: [{ categoryId: null }, { category: { shopId, isVisible: true } }],
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
          where: { shopId, productId, isAvailable: true },
          select: { id: true, name: true, isRequired: true },
          orderBy: [...orderBy],
        },
        variants: {
          where: {
            shopId,
            productId,
            isAvailable: true,
            OR: [
              { optionGroupId: null },
              {
                optionGroup: { shopId, productId, isAvailable: true },
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
            shopId,
            productId,
            addOn: { shopId, isAvailable: true },
          },
          select: {
            addOn: { select: { id: true, name: true, priceAdjustment: true } },
          },
          orderBy: [{ addOn: { sortOrder: 'asc' } }, { addOnId: 'asc' }],
        },
      },
    } satisfies Prisma.ProductFindManyArgs;
  }
}
