import { BadRequestException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';
import type {
  CreateProductOptionGroupRequest,
  CreateProductVariantRequest,
  UpdateProductOptionGroupRequest,
  UpdateProductVariantRequest,
} from '@paserve/contracts';

const roles = ['OWNER', 'ADMIN', 'MANAGER'] as const;
const orderBy = [
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
] as const;
@Injectable()
export class ProductVariantsRepository {
  constructor(private readonly prisma: PrismaService) {}
  private requireId(id: string) {
    if (!isUUID(id))
      throw new BadRequestException({
        code: 'INVALID_RESOURCE_ID',
        message: 'Enter a valid shop resource identifier.',
      });
  }
  private productWhere(userId: string, shopId: string, productId: string) {
    this.requireId(productId);
    return {
      id: productId,
      shopId,
      isArchived: false,
      shop: shopAccessWhere(userId, shopId, roles),
    };
  }
  list(userId: string, shopId: string, productId: string) {
    return this.prisma.product.findFirst({
      where: this.productWhere(userId, shopId, productId),
      select: {
        optionGroups: { where: { shopId, productId }, orderBy: [...orderBy] },
        variants: { where: { shopId, productId }, orderBy: [...orderBy] },
      },
    });
  }
  createGroup(
    userId: string,
    shopId: string,
    productId: string,
    dto: CreateProductOptionGroupRequest,
  ) {
    // Nested conditional parent writes repeat live access and archive predicates atomically.
    return this.prisma.product.update({
      where: this.productWhere(userId, shopId, productId),
      data: {
        optionGroups: {
          create: {
            name: dto.name,
            isRequired: dto.isRequired,
            isAvailable: dto.isAvailable,
            sortOrder: dto.sortOrder,
          },
        },
      },
      select: {
        optionGroups: { where: { shopId, productId, name: dto.name } },
      },
    });
  }
  createVariant(
    userId: string,
    shopId: string,
    productId: string,
    dto: CreateProductVariantRequest,
  ) {
    // Composite FK also enforces that a group belongs to this product and shop.
    return this.prisma.product.update({
      where: this.productWhere(userId, shopId, productId),
      data: {
        variants: {
          create: {
            name: dto.name,
            priceAdjustment: dto.priceAdjustment,
            isDefault: dto.isDefault,
            optionGroupId: dto.optionGroupId,
            isAvailable: dto.isAvailable,
            sortOrder: dto.sortOrder,
          },
        },
      },
      select: {
        variants: {
          where: {
            shopId,
            productId,
            name: dto.name,
            optionGroupId: dto.optionGroupId ?? null,
          },
        },
      },
    });
  }
  updateGroup(
    userId: string,
    shopId: string,
    productId: string,
    id: string,
    dto: UpdateProductOptionGroupRequest,
  ) {
    this.requireId(id);
    return this.prisma.productOptionGroup.update({
      where: {
        id,
        shopId,
        productId,
        product: this.productWhere(userId, shopId, productId),
      },
      data: {
        name: dto.name,
        isRequired: dto.isRequired,
        isAvailable: dto.isAvailable,
        sortOrder: dto.sortOrder,
      },
    });
  }
  updateVariant(
    userId: string,
    shopId: string,
    productId: string,
    id: string,
    dto: UpdateProductVariantRequest,
  ) {
    this.requireId(id);
    return this.prisma.productVariant.update({
      where: {
        id,
        shopId,
        productId,
        product: this.productWhere(userId, shopId, productId),
      },
      data: {
        name: dto.name,
        priceAdjustment: dto.priceAdjustment,
        isDefault: dto.isDefault,
        optionGroupId: dto.optionGroupId,
        isAvailable: dto.isAvailable,
        sortOrder: dto.sortOrder,
      },
    });
  }
  findVariant(userId: string, shopId: string, productId: string, id: string) {
    this.requireId(id);
    return this.prisma.productVariant.findFirst({
      where: {
        id,
        shopId,
        productId,
        product: this.productWhere(userId, shopId, productId),
      },
    });
  }
}
