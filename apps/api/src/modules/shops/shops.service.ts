import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type {
  CreateShopResponse,
  UpdateShopResponse,
} from '@paserve/contracts';
import { normalizeShopPrimaryColor } from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { ShopsRepository, type ShopSettingsData } from './shops.repository.js';
import type { CreateShopDto } from './dto/create-shop.dto.js';
import { generateShopSlug, SHOP_SLUG_MAX_ATTEMPTS } from './shop-slug.js';
import type { UpdateShopDto } from './dto/update-shop.dto.js';

@Injectable()
export class ShopsService {
  constructor(private readonly repository: ShopsRepository) {}

  async getSettings(
    userId: string,
    shopId: string,
  ): Promise<UpdateShopResponse> {
    const shop = await this.repository.findSettings(userId, shopId);
    if (!shop)
      throw new ForbiddenException({
        code: 'OWNER_REQUIRED',
        message:
          'Your owner access is no longer available. Please refresh and try again.',
      });
    return { shop: { ...shop, createdAt: shop.createdAt.toISOString() } };
  }

  async updateSettings(
    userId: string,
    shopId: string,
    dto: UpdateShopDto,
  ): Promise<UpdateShopResponse> {
    const fields = [
      'name',
      'description',
      'displayName',
      'phone',
      'contactEmail',
      'website',
      'address',
      'operatingHours',
      'primaryColor',
      'accentColor',
      'menuLayout',
    ] as const;
    const data: ShopSettingsData = {};
    if (dto.acceptingOrders !== undefined)
      data.acceptingOrders = dto.acceptingOrders;
    for (const field of fields) {
      const value = dto[field];
      if (value !== undefined) {
        if (field === 'name') data.name = value.trim();
        else if (field === 'menuLayout') data.menuLayout = dto.menuLayout;
        else if (field === 'primaryColor' || field === 'accentColor')
          data[field] = normalizeShopPrimaryColor(value) || null;
        else data[field] = value.trim() || null;
      }
    }
    if (!Object.keys(data).length)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Provide at least one shop setting to update.',
      });
    try {
      const shop = await this.repository.updateSettings(userId, shopId, data);
      return { shop: { ...shop, createdAt: shop.createdAt.toISOString() } };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ForbiddenException({
          code: 'OWNER_REQUIRED',
          message:
            'Your owner access is no longer available. Please refresh and try again.',
        });
      }
      throw error;
    }
  }

  async create(
    userId: string,
    dto: CreateShopDto,
  ): Promise<CreateShopResponse> {
    const name = dto.name.trim();
    for (let attempt = 0; attempt < SHOP_SLUG_MAX_ATTEMPTS; attempt++) {
      const slug = generateShopSlug(name, attempt > 0);
      try {
        const shop = await this.repository.createWithOwner(
          userId,
          name,
          slug,
          dto.description?.trim() || null,
        );
        const membership = shop.members[0];
        return {
          shop: {
            id: shop.id,
            name: shop.name,
            slug: shop.slug,
            description: shop.description,
            isActive: shop.isActive,
            createdAt: shop.createdAt.toISOString(),
          },
          membership: {
            ...membership,
            shop: {
              id: shop.id,
              name: shop.name,
              slug: shop.slug,
              isActive: shop.isActive,
            },
          },
        };
      } catch (error: unknown) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        )
          throw error;
        // Retry only a slug conflict, never an unrelated membership failure.
        const target = error.meta?.target;
        const adapterError = error.meta?.driverAdapterError as
          | {
              cause?: { constraint?: { index?: string; fields?: string[] } };
            }
          | undefined;
        const constraint = adapterError?.cause?.constraint;
        const slugConflict =
          (Array.isArray(target) && target.includes('slug')) ||
          constraint?.index === 'shops_slug_key' ||
          constraint?.fields?.includes('slug');
        if (!slugConflict) throw error;
      }
    }
    throw new ConflictException({
      code: 'SHOP_SLUG_UNAVAILABLE',
      message: 'We could not reserve a shop address. Please try again.',
    });
  }
}
