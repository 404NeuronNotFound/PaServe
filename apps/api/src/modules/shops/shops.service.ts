import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CreateShopResponse } from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { ShopsRepository } from './shops.repository.js';
import type { CreateShopDto } from './dto/create-shop.dto.js';

function slugBase(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/g, '');
  const reserved = ['app', 'api', 'admin', 'login', 'register', 'shops'];
  return !slug || reserved.includes(slug) ? 'shop' : slug;
}

@Injectable()
export class ShopsService {
  constructor(private readonly repository: ShopsRepository) {}

  async create(
    userId: string,
    dto: CreateShopDto,
  ): Promise<CreateShopResponse> {
    const name = dto.name.trim();
    const base = slugBase(name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${randomUUID().slice(0, 8)}`;
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
