import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type {
  CategoriesResponse,
  CreateCategoryResponse,
} from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { CategoriesRepository } from './categories.repository.js';
import { categorySlug } from './category-slug.js';
import type { CreateCategoryDto } from './create-category.dto.js';

const lostAccess = () =>
  new ForbiddenException({
    code: 'SHOP_PERMISSION_REQUIRED',
    message:
      'Your menu management access is no longer available. Please refresh and try again.',
  });
@Injectable()
export class CategoriesService {
  constructor(
    private readonly repository: CategoriesRepository,
    private readonly members: ShopMembersService,
  ) {}
  async list(userId: string, shopId: string): Promise<CategoriesResponse> {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    const result = await this.repository.list(userId, shopId);
    if (!result) throw lostAccess();
    return {
      categories: result.categories.map((category) => ({
        ...category,
        createdAt: category.createdAt.toISOString(),
      })),
    };
  }
  async create(
    userId: string,
    shopId: string,
    dto: CreateCategoryDto,
  ): Promise<CreateCategoryResponse> {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    const name = dto.name.trim().replace(/\s+/g, ' ');
    try {
      const result = await this.repository.create(
        userId,
        shopId,
        name,
        categorySlug(name),
      );
      const category = result.categories[0];
      return {
        category: { ...category, createdAt: category.createdAt.toISOString() },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') throw lostAccess();
        if (error.code === 'P2002')
          throw new ConflictException({
            code: 'CATEGORY_ALREADY_EXISTS',
            message:
              'A category with this menu address already exists in this shop. Choose a different name.',
            fieldErrors: { name: ['Choose a different category name.'] },
          });
      }
      throw error;
    }
  }
}
