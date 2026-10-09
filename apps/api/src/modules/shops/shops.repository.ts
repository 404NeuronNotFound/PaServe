import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { UpdateShopRequest } from '@paserve/contracts';
export type ShopSettingsData = { name?: string } & {
  [K in Exclude<keyof UpdateShopRequest, 'name'>]?: string | null;
};

const settingsSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isActive: true,
  createdAt: true,
  displayName: true,
  phone: true,
  contactEmail: true,
  website: true,
  address: true,
  operatingHours: true,
} as const;

@Injectable()
export class ShopsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findSettings(userId: string, shopId: string) {
    return this.prisma.shop.findFirst({
      where: {
        id: shopId,
        isActive: true,
        members: { some: { userId, role: 'OWNER', user: { isActive: true } } },
      },
      select: settingsSelect,
    });
  }

  updateSettings(userId: string, shopId: string, data: ShopSettingsData) {
    return this.prisma.shop.update({
      // Check ownership in the write too, in case it changed after the guard.
      where: {
        id: shopId,
        isActive: true,
        members: { some: { userId, role: 'OWNER', user: { isActive: true } } },
      },
      data,
      select: settingsSelect,
    });
  }

  createWithOwner(
    userId: string,
    name: string,
    slug: string,
    description: string | null,
  ) {
    // Prisma nested writes are atomic: an owner failure rolls back the shop.
    return this.prisma.shop.create({
      data: {
        name,
        slug,
        description,
        // Ownership is assigned by the server on this shop's membership only.
        members: { create: { userId, role: 'OWNER' } },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        isActive: true,
        createdAt: true,
        members: { select: { id: true, shopId: true, role: true } },
      },
    });
  }
}
