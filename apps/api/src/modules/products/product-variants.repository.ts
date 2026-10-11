import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
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
  async deleteVariant(
    userId: string,
    shopId: string,
    productId: string,
    id: string,
  ): Promise<void> {
    this.requireId(id);
    const where = {
      id,
      shopId,
      productId,
      product: this.productWhere(userId, shopId, productId),
    };
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const variant = await tx.productVariant.findFirst({
            where,
            include: {
              optionGroup: {
                select: {
                  isRequired: true,
                  variants: {
                    where: {
                      shopId,
                      productId,
                      id: { not: id },
                      isAvailable: true,
                    },
                    select: { id: true },
                    take: 1,
                  },
                },
              },
            },
          });
          if (!variant)
            throw new NotFoundException({
              code: 'RESOURCE_NOT_ACCESSIBLE',
              message:
                'This option is unavailable in this shop, or your access changed.',
            });
          if (variant.isDefault)
            throw new ConflictException({
              code: 'DEFAULT_VARIANT_DELETE_CONFLICT',
              message:
                'Uncheck Use as the default option and save before deleting this option. Choose a new default if needed.',
            });
          if (
            variant.isAvailable &&
            variant.optionGroup?.isRequired &&
            !variant.optionGroup.variants.length
          )
            throw new ConflictException({
              code: 'REQUIRED_GROUP_DELETE_CONFLICT',
              message:
                'This is the last available option in a required group. Add another available option or make the group optional before deleting it.',
            });
          await tx.productVariant.delete({
            where: { ...where, isDefault: false },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      )
        throw new ConflictException({
          code: 'VARIANT_DELETE_CONFLICT',
          message:
            'The options changed while you were deleting. Close the editor and refresh before trying again.',
        });
      throw error;
    }
  }
}
