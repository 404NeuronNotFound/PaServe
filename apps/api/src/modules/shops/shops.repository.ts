import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { UpdateShopRequest } from '@paserve/contracts';
import { shopAccessWhere } from '../tenancy/shop-scope.js';
export type ShopSettingsData = Pick<
  UpdateShopRequest,
  'name' | 'menuLayout' | 'acceptingOrders'
> & {
  [
    K in Exclude<
      keyof UpdateShopRequest,
      'name' | 'menuLayout' | 'acceptingOrders'
    >
  ]?: string | null;
};

const settingsSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isActive: true,
  acceptingOrders: true,
  createdAt: true,
  displayName: true,
  phone: true,
  contactEmail: true,
  website: true,
  address: true,
  operatingHours: true,
  logoUrl: true,
  bannerUrl: true,
  primaryColor: true,
  accentColor: true,
  menuLayout: true,
} as const;

@Injectable()
export class ShopsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findSettings(userId: string, shopId: string) {
    return this.prisma.shop.findFirst({
      where: shopAccessWhere(userId, shopId, ['OWNER']),
      select: settingsSelect,
    });
  }

  updateLogo(
    userId: string,
    shopId: string,
    expectedLogoUrl: string | null,
    logoUrl: string,
  ) {
    return this.prisma.shop.update({
      where: {
        ...shopAccessWhere(userId, shopId, ['OWNER']),
        logoUrl: expectedLogoUrl,
      },
      data: { logoUrl },
      select: settingsSelect,
    });
  }

  updateSettings(userId: string, shopId: string, data: ShopSettingsData) {
    return this.prisma.shop.update({
      // Check ownership in the write too, in case it changed after the guard.
      where: shopAccessWhere(userId, shopId, ['OWNER']),
      data,
      select: settingsSelect,
    });
  }

  updateBanner(
    userId: string,
    shopId: string,
    expectedBannerUrl: string | null,
    bannerUrl: string,
  ) {
    return this.prisma.shop.update({
      where: {
        ...shopAccessWhere(userId, shopId, ['OWNER']),
        bannerUrl: expectedBannerUrl,
      },
      data: { bannerUrl },
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
