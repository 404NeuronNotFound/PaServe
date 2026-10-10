import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import type {
  CreateProductResponse,
  ProductsResponse,
} from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { ProductsRepository } from './products.repository.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { TenantResourcesService } from '../tenancy/tenant-resources.service.js';
import type { CreateProductDto } from './create-product.dto.js';
import { productSlug } from './product-slug.js';
import type { UpdateProductDto } from './update-product.dto.js';
import type { ProductCreateData } from './products.repository.js';
import type { ProductArchiveDto } from './product-archive.dto.js';
import type { ProductAvailableDto } from './product-available.dto.js';
import type { ProductFeaturedDto } from './product-featured.dto.js';
import type { ReorderProductsDto } from './reorder-products.dto.js';

@Injectable()
export class ProductsService {
  constructor(
    private readonly repository: ProductsRepository,
    private readonly members: ShopMembersService,
    private readonly resources: TenantResourcesService,
  ) {}
  async reorder(
    userId: string,
    shopId: string,
    dto: ReorderProductsDto,
  ): Promise<ProductsResponse> {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    if (
      dto.productIds.length !== dto.expectedOrder.length ||
      dto.productIds.some((id) => !dto.expectedOrder.includes(id))
    )
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Provide the same complete product group in both orders.',
      });
    if (dto.categoryId)
      await this.resources.requireResource(
        userId,
        shopId,
        'category',
        dto.categoryId,
      );
    try {
      const products = await this.repository.reorder(
        userId,
        shopId,
        dto.categoryId,
        dto.productIds,
        dto.expectedOrder,
      );
      return {
        products: products.map((product) => ({
          ...product,
          price: product.price.toFixed(2),
          createdAt: product.createdAt.toISOString(),
        })),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025')
          throw new ForbiddenException({
            code: 'SHOP_PERMISSION_REQUIRED',
            message:
              'Your menu management access or product group changed. Refresh before saving.',
          });
        if (error.code === 'P2034')
          throw new ConflictException({
            code: 'PRODUCT_ORDER_CHANGED',
            message:
              'The menu changed while saving. Refresh before saving again.',
          });
      }
      throw error;
    }
  }
  async setFeatured(
    userId: string,
    shopId: string,
    productId: string,
    dto: ProductFeaturedDto,
  ): Promise<CreateProductResponse> {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    await this.resources.requireResource(userId, shopId, 'product', productId);
    try {
      const product = await this.repository.setFeatured(
        userId,
        shopId,
        productId,
        dto.isFeatured,
        dto.expectedFeatured,
      );
      return {
        product: {
          ...product,
          price: product.price.toFixed(2),
          createdAt: product.createdAt.toISOString(),
        },
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        await this.members.requirePermission(
          userId,
          shopId,
          'shop.menu.manage',
        );
        await this.resources.requireResource(
          userId,
          shopId,
          'product',
          productId,
        );
        throw new ConflictException({
          code: 'PRODUCT_FEATURED_CHANGED',
          message:
            'Featured selection or archive state changed. Refresh products before trying again.',
        });
      }
      throw error;
    }
  }
  async setAvailable(
    userId: string,
    shopId: string,
    productId: string,
    dto: ProductAvailableDto,
  ): Promise<CreateProductResponse> {
    return this.changeAvailability(userId, shopId, productId, dto, 'AVAILABLE');
  }
  async setSoldOut(
    userId: string,
    shopId: string,
    productId: string,
    dto: ProductAvailableDto,
  ): Promise<CreateProductResponse> {
    return this.changeAvailability(userId, shopId, productId, dto, 'SOLD_OUT');
  }
  async setHidden(
    userId: string,
    shopId: string,
    productId: string,
    dto: ProductAvailableDto,
  ): Promise<CreateProductResponse> {
    return this.changeAvailability(userId, shopId, productId, dto, 'HIDDEN');
  }
  private async changeAvailability(
    userId: string,
    shopId: string,
    productId: string,
    dto: ProductAvailableDto,
    targetStatus: 'AVAILABLE' | 'SOLD_OUT' | 'HIDDEN',
  ): Promise<CreateProductResponse> {
    await this.members.requirePermission(
      userId,
      shopId,
      'shop.menu.availability.update',
    );
    if (dto.expectedStatus === 'HIDDEN' || targetStatus === 'HIDDEN')
      await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    await this.resources.requireResource(userId, shopId, 'product', productId);
    try {
      const write =
        targetStatus === 'HIDDEN'
          ? this.repository.setHidden.bind(this.repository)
          : targetStatus === 'SOLD_OUT'
            ? this.repository.setSoldOut.bind(this.repository)
            : this.repository.setAvailable.bind(this.repository);
      const product = await write(
        userId,
        shopId,
        productId,
        dto.expectedStatus,
      );
      return {
        product: {
          ...product,
          price: product.price.toFixed(2),
          createdAt: product.createdAt.toISOString(),
        },
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        await this.members.requirePermission(
          userId,
          shopId,
          'shop.menu.availability.update',
        );
        if (dto.expectedStatus === 'HIDDEN' || targetStatus === 'HIDDEN')
          await this.members.requirePermission(
            userId,
            shopId,
            'shop.menu.manage',
          );
        await this.resources.requireResource(
          userId,
          shopId,
          'product',
          productId,
        );
        throw new ConflictException({
          code: 'PRODUCT_AVAILABILITY_CHANGED',
          message:
            'The product status or archive state changed. Refresh products before trying again.',
        });
      }
      throw error;
    }
  }
  async setArchived(
    userId: string,
    shopId: string,
    productId: string,
    dto: ProductArchiveDto,
  ): Promise<CreateProductResponse> {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    await this.resources.requireResource(userId, shopId, 'product', productId);
    try {
      const product = await this.repository.setArchived(
        userId,
        shopId,
        productId,
        dto.isArchived,
        dto.expectedArchived,
      );
      return {
        product: {
          ...product,
          price: product.price.toFixed(2),
          createdAt: product.createdAt.toISOString(),
        },
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        await this.members.requirePermission(
          userId,
          shopId,
          'shop.menu.manage',
        );
        await this.resources.requireResource(
          userId,
          shopId,
          'product',
          productId,
        );
        throw new ConflictException({
          code: 'PRODUCT_ARCHIVE_CHANGED',
          message:
            'The product archive status changed. Refresh products before trying again.',
        });
      }
      throw error;
    }
  }
  async update(
    userId: string,
    shopId: string,
    productId: string,
    dto: UpdateProductDto,
  ): Promise<CreateProductResponse> {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    await this.resources.requireResource(userId, shopId, 'product', productId);
    if (Object.values(dto).every((value) => value === undefined))
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Provide at least one product field to update.',
      });
    if (dto.categoryId)
      await this.resources.requireResource(
        userId,
        shopId,
        'category',
        dto.categoryId,
      );
    const data: Partial<Omit<ProductCreateData, 'slug'>> = {};
    if (dto.name !== undefined)
      data.name = dto.name.trim().replace(/\s+/g, ' ');
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.description !== undefined)
      data.description = dto.description.trim() || null;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl.trim() || null;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.isFeatured !== undefined) data.isFeatured = dto.isFeatured;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    try {
      const product = await this.repository.update(
        userId,
        shopId,
        productId,
        dto.categoryId,
        data,
      );
      return {
        product: {
          ...product,
          price: product.price.toFixed(2),
          createdAt: product.createdAt.toISOString(),
        },
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2025', 'P2003'].includes(error.code)
      )
        throw new NotFoundException({
          code: 'RESOURCE_NOT_ACCESSIBLE',
          message:
            'The product or category is unavailable, or your access changed. Refresh before trying again.',
        });
      throw error;
    }
  }
  async create(
    userId: string,
    shopId: string,
    dto: CreateProductDto,
  ): Promise<CreateProductResponse> {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    if (dto.categoryId)
      await this.resources.requireResource(
        userId,
        shopId,
        'category',
        dto.categoryId,
      );
    const name = dto.name.trim().replace(/\s+/g, ' ');
    try {
      const result = await this.repository.create(
        userId,
        shopId,
        dto.categoryId,
        {
          name,
          slug: productSlug(name),
          description: dto.description?.trim() || null,
          price: dto.price,
          imageUrl: dto.imageUrl?.trim() || null,
          status: dto.status ?? 'AVAILABLE',
          isFeatured: dto.isFeatured ?? false,
          sortOrder: dto.sortOrder ?? 0,
        },
      );
      const product = result.products[0];
      return {
        product: {
          ...product,
          price: product.price.toFixed(2),
          createdAt: product.createdAt.toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002')
          throw new ConflictException({
            code: 'PRODUCT_ALREADY_EXISTS',
            message:
              'A product with this menu address already exists. Choose a different name.',
            fieldErrors: { name: ['Choose a different product name.'] },
          });
        if (error.code === 'P2025' || error.code === 'P2003')
          throw new NotFoundException({
            code: 'RESOURCE_NOT_ACCESSIBLE',
            message:
              'The shop or category is unavailable, or your access changed. Refresh before trying again.',
          });
      }
      throw error;
    }
  }
  async list(userId: string, shopId: string): Promise<ProductsResponse> {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    const result = await this.repository.list(userId, shopId);
    if (!result)
      throw new ForbiddenException({
        code: 'SHOP_PERMISSION_REQUIRED',
        message: 'Your menu management access is no longer available.',
      });
    return {
      products: result.products.map((product) => ({
        ...product,
        price: product.price.toFixed(2),
        createdAt: product.createdAt.toISOString(),
      })),
    };
  }
}
