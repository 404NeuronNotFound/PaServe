import {
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type {
  CategoriesResponse,
  CreateCategoryResponse,
} from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { isTransactionConflict } from '../../database/transaction-conflict.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { CategoriesRepository } from './categories.repository.js';
import { categorySlug } from './category-slug.js';
import type { CreateCategoryDto } from './create-category.dto.js';
import type { UpdateCategoryDto } from './update-category.dto.js';
import { TenantResourcesService } from '../tenancy/tenant-resources.service.js';
import type { CategoryVisibilityDto } from './category-visibility.dto.js';
import type { ReorderCategoriesDto } from './reorder-categories.dto.js';

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
    private readonly resources: TenantResourcesService,
  ) {}
  async reorder(
    userId: string,
    shopId: string,
    dto: ReorderCategoriesDto,
  ): Promise<CategoriesResponse> {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    if (
      dto.categoryIds.length !== dto.expectedOrder.length ||
      dto.categoryIds.some((id) => !dto.expectedOrder.includes(id))
    )
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Provide the same complete category list in both orders.',
      });
    try {
      const categories = await this.repository.reorder(
        userId,
        shopId,
        dto.categoryIds,
        dto.expectedOrder,
      );
      return {
        categories: categories.map((category) => ({
          ...category,
          createdAt: category.createdAt.toISOString(),
        })),
      };
    } catch (error) {
      if (isTransactionConflict(error))
        throw new ConflictException({
          code: 'CATEGORY_ORDER_CHANGED',
          message: 'The menu changed while saving. Refresh before saving again.',
        });
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') throw lostAccess();
      }
      throw error;
    }
  }
  async setVisibility(
    userId: string,
    shopId: string,
    categoryId: string,
    dto: CategoryVisibilityDto,
  ): Promise<CreateCategoryResponse> {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    await this.resources.requireResource(
      userId,
      shopId,
      'category',
      categoryId,
    );
    try {
      const category = await this.repository.setVisibility(
        userId,
        shopId,
        categoryId,
        dto.isVisible,
        dto.expectedVisibility,
      );
      return {
        category: { ...category, createdAt: category.createdAt.toISOString() },
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        // Distinguish stale visibility from revoked access without leaking foreign resources.
        await this.members.requirePermission(
          userId,
          shopId,
          'shop.menu.manage',
        );
        await this.resources.requireResource(
          userId,
          shopId,
          'category',
          categoryId,
        );
        throw new ConflictException({
          code: 'CATEGORY_VISIBILITY_CHANGED',
          message:
            'Category visibility changed. Refresh the categories before trying again.',
        });
      }
      throw error;
    }
  }
  async delete(
    userId: string,
    shopId: string,
    categoryId: string,
  ): Promise<void> {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    await this.resources.requireResource(
      userId,
      shopId,
      'category',
      categoryId,
    );
    try {
      await this.repository.delete(userId, shopId, categoryId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      )
        throw new NotFoundException({
          code: 'RESOURCE_NOT_ACCESSIBLE',
          message: 'This category is unavailable or you no longer have access.',
        });
      throw error;
    }
  }
  async update(
    userId: string,
    shopId: string,
    categoryId: string,
    dto: UpdateCategoryDto,
  ): Promise<CreateCategoryResponse> {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    await this.resources.requireResource(
      userId,
      shopId,
      'category',
      categoryId,
    );
    const data: { name?: string; description?: string | null } = {};
    if (dto.name !== undefined)
      data.name = dto.name.trim().replace(/\s+/g, ' ');
    if (dto.description !== undefined)
      data.description = dto.description.trim() || null;
    if (!Object.keys(data).length)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Provide at least one category detail to update.',
      });
    try {
      const category = await this.repository.update(
        userId,
        shopId,
        categoryId,
        data,
      );
      return {
        category: { ...category, createdAt: category.createdAt.toISOString() },
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      )
        throw new NotFoundException({
          code: 'RESOURCE_NOT_ACCESSIBLE',
          message: 'This category is unavailable or you no longer have access.',
        });
      throw error;
    }
  }
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
