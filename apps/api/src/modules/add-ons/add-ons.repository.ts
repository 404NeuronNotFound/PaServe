import { rolesForShopPermissions } from '@paserve/contracts';
import { BadRequestException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';
import type {
  CreateAddOnRequest,
  UpdateAddOnRequest,
} from '@paserve/contracts';

const roles = rolesForShopPermissions('shop.menu.manage');
const orderBy = [
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
] as const;
@Injectable()
export class AddOnsRepository {
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
  list(userId: string, shopId: string) {
    return this.prisma.shop.findFirst({
      where: shopAccessWhere(userId, shopId, roles),
      select: {
        addOns: {
          where: { shopId },
          orderBy: [...orderBy],
          include: {
            products: {
              where: { shopId, product: { shopId } },
              select: {
                product: { select: { id: true, name: true, isArchived: true } },
              },
              orderBy: { product: { name: 'asc' } },
            },
          },
        },
      },
    });
  }
  create(userId: string, shopId: string, dto: CreateAddOnRequest) {
    return this.prisma.shop.update({
      where: shopAccessWhere(userId, shopId, roles),
      data: {
        addOns: {
          create: {
            name: dto.name,
            priceAdjustment: dto.priceAdjustment,
            isAvailable: dto.isAvailable,
            sortOrder: dto.sortOrder,
          },
        },
      },
      select: { addOns: { where: { shopId, name: dto.name } } },
    });
  }
  update(userId: string, shopId: string, id: string, dto: UpdateAddOnRequest) {
    this.requireId(id);
    return this.prisma.addOn.update({
      where: { id, shopId, shop: shopAccessWhere(userId, shopId, roles) },
      data: {
        name: dto.name,
        priceAdjustment: dto.priceAdjustment,
        isAvailable: dto.isAvailable,
        sortOrder: dto.sortOrder,
      },
    });
  }
  productList(userId: string, shopId: string, productId: string) {
    return this.prisma.product.findFirst({
      where: this.productWhere(userId, shopId, productId),
      select: {
        addOns: {
          where: { shopId, productId, addOn: { shopId } },
          include: { addOn: true },
          orderBy: { addOn: { sortOrder: 'asc' } },
        },
      },
    });
  }
  delete(userId: string, shopId: string, id: string) {
    this.requireId(id);
    // The composite foreign key removes product assignments in this same write.
    return this.prisma.addOn.delete({
      where: { id, shopId, shop: shopAccessWhere(userId, shopId, roles) },
    });
  }
  assign(userId: string, shopId: string, productId: string, addOnId: string) {
    this.requireId(addOnId);
    return this.prisma.product.update({
      where: this.productWhere(userId, shopId, productId),
      data: { addOns: { create: { addOnId } } },
      select: {
        addOns: {
          where: { shopId, productId, addOnId, addOn: { shopId } },
          include: { addOn: true },
        },
      },
    });
  }
  unassign(userId: string, shopId: string, productId: string, addOnId: string) {
    this.requireId(addOnId);
    return this.prisma.productAddOn.deleteMany({
      where: {
        shopId,
        productId,
        addOnId,
        product: this.productWhere(userId, shopId, productId),
      },
    });
  }
  async publicProduct(slug: string, productId: string) {
    this.requireId(productId);
    const shop = await this.prisma.shop.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
    });
    if (!shop) return null;
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
        price: true,
        status: true,
        addOns: {
          where: {
            shopId: shop.id,
            productId,
            addOn: { shopId: shop.id, isAvailable: true },
          },
          include: { addOn: true },
          orderBy: { addOn: { sortOrder: 'asc' } },
        },
      },
    });
  }
}
