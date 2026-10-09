import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
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

@Injectable()
export class ProductsService {
  constructor(
    private readonly repository: ProductsRepository,
    private readonly members: ShopMembersService,
    private readonly resources: TenantResourcesService,
  ) {}
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
