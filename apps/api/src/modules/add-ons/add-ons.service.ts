import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PRODUCT_CURRENCY,
  type AddOnResponse,
  type AddOnsResponse,
  type PublicProductAddOnsResponse,
  type ProductAddOnQuoteResponse,
} from '@paserve/contracts';
import { Prisma, type AddOn } from '../../generated/prisma/client.js';
import { AddOnsRepository } from './add-ons.repository.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { TenantResourcesService } from '../tenancy/tenant-resources.service.js';
import type {
  CreateAddOnDto,
  UpdateAddOnDto,
  AddOnSelectionDto,
} from './add-ons.dto.js';

const serialize = (addOn: AddOn) => ({
  ...addOn,
  priceAdjustment: addOn.priceAdjustment.toFixed(2),
  createdAt: addOn.createdAt.toISOString(),
  updatedAt: addOn.updatedAt.toISOString(),
});
const publicSerialize = (addOn: AddOn) => ({
  id: addOn.id,
  name: addOn.name,
  priceAdjustment: addOn.priceAdjustment.toFixed(2),
});
const unavailable = () =>
  new NotFoundException({
    code: 'RESOURCE_NOT_ACCESSIBLE',
    message:
      'This resource is unavailable in this shop, or your access changed.',
  });
@Injectable()
export class AddOnsService {
  constructor(
    private readonly repository: AddOnsRepository,
    private readonly members: ShopMembersService,
    private readonly resources: TenantResourcesService,
  ) {}
  private async authorize(userId: string, shopId: string, productId?: string) {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    if (productId !== undefined)
      await this.resources.requireResource(
        userId,
        shopId,
        'product',
        productId,
      );
  }
  private async write<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002')
          throw new ConflictException({
            code: 'ADD_ON_CONFLICT',
            message: 'This add-on name or product assignment already exists.',
          });
        if (['P2025', 'P2003'].includes(error.code)) throw unavailable();
      }
      throw error;
    }
  }
  async list(userId: string, shopId: string): Promise<AddOnsResponse> {
    await this.authorize(userId, shopId);
    const result = await this.repository.list(userId, shopId);
    if (!result)
      throw new ForbiddenException({
        code: 'SHOP_PERMISSION_REQUIRED',
        message: 'Your menu management access is no longer available.',
      });
    return { addOns: result.addOns.map(serialize) };
  }
  async create(
    userId: string,
    shopId: string,
    dto: CreateAddOnDto,
  ): Promise<AddOnResponse> {
    await this.authorize(userId, shopId);
    return this.write(async () => ({
      addOn: serialize(
        (await this.repository.create(userId, shopId, dto)).addOns[0],
      ),
    }));
  }
  async update(
    userId: string,
    shopId: string,
    id: string,
    dto: UpdateAddOnDto,
  ): Promise<AddOnResponse> {
    await this.authorize(userId, shopId);
    await this.resources.requireResource(userId, shopId, 'addOn', id);
    if (Object.values(dto).every((value) => value === undefined))
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Provide at least one field to update.',
      });
    return this.write(async () => ({
      addOn: serialize(await this.repository.update(userId, shopId, id, dto)),
    }));
  }
  async productList(
    userId: string,
    shopId: string,
    productId: string,
  ): Promise<AddOnsResponse> {
    await this.authorize(userId, shopId, productId);
    const result = await this.repository.productList(userId, shopId, productId);
    if (!result) throw unavailable();
    return { addOns: result.addOns.map((link) => serialize(link.addOn)) };
  }
  async assign(
    userId: string,
    shopId: string,
    productId: string,
    addOnId: string,
  ): Promise<AddOnResponse> {
    await this.authorize(userId, shopId, productId);
    await this.resources.requireResource(userId, shopId, 'addOn', addOnId);
    return this.write(async () => ({
      addOn: serialize(
        (await this.repository.assign(userId, shopId, productId, addOnId))
          .addOns[0].addOn,
      ),
    }));
  }
  async unassign(
    userId: string,
    shopId: string,
    productId: string,
    addOnId: string,
  ) {
    await this.authorize(userId, shopId, productId);
    const result = await this.repository.unassign(
      userId,
      shopId,
      productId,
      addOnId,
    );
    if (!result.count) throw unavailable();
    return { removed: true as const };
  }
  private async publicProduct(slug: string, productId: string) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100)
      throw new NotFoundException({
        code: 'PRODUCT_NOT_AVAILABLE',
        message: 'This product is unavailable.',
      });
    const product = await this.repository.publicProduct(slug, productId);
    if (!product)
      throw new NotFoundException({
        code: 'PRODUCT_NOT_AVAILABLE',
        message: 'This product is unavailable.',
      });
    return product;
  }
  async publicList(
    slug: string,
    productId: string,
  ): Promise<PublicProductAddOnsResponse> {
    const product = await this.publicProduct(slug, productId);
    return {
      productId: product.id,
      isOrderable: product.status === 'AVAILABLE',
      addOns: product.addOns.map((link) => publicSerialize(link.addOn)),
    };
  }
  async quote(
    slug: string,
    productId: string,
    dto: AddOnSelectionDto,
  ): Promise<ProductAddOnQuoteResponse> {
    const product = await this.publicProduct(slug, productId);
    if (product.status !== 'AVAILABLE')
      throw new NotFoundException({
        code: 'PRODUCT_NOT_AVAILABLE',
        message: 'This product is unavailable.',
      });
    const allowed = new Map(
      product.addOns.map((link) => [link.addOnId, link.addOn]),
    );
    if (
      new Set(dto.addOnIds).size !== dto.addOnIds.length ||
      dto.addOnIds.some((id) => !allowed.has(id))
    )
      throw new BadRequestException({
        code: 'ADD_ON_SELECTION_INVALID',
        message:
          'One or more add-ons are unavailable or not allowed for this product.',
      });
    const selected = dto.addOnIds.map((id) => allowed.get(id)!);
    const total = selected.reduce(
      (sum, addOn) => sum.plus(addOn.priceAdjustment),
      new Prisma.Decimal(0),
    );
    return {
      productId: product.id,
      currency: PRODUCT_CURRENCY,
      basePrice: product.price.toFixed(2),
      addOns: selected.map(publicSerialize),
      addOnTotal: total.toFixed(2),
      baseWithAddOnsPrice: product.price.plus(total).toFixed(2),
    };
  }
}
