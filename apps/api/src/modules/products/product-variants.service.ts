import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ProductVariantsResponse } from '@paserve/contracts';
import {
  Prisma,
  type ProductVariant,
  type ProductOptionGroup,
} from '../../generated/prisma/client.js';
import { ProductVariantsRepository } from './product-variants.repository.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { TenantResourcesService } from '../tenancy/tenant-resources.service.js';
import type {
  CreateProductOptionGroupDto,
  CreateProductVariantDto,
  UpdateProductOptionGroupDto,
  UpdateProductVariantDto,
  CreateRegularVariantDto,
  CreateLargeVariantDto,
} from './product-variants.dto.js';

const groupResponse = (group: ProductOptionGroup) => ({
  ...group,
  createdAt: group.createdAt.toISOString(),
  updatedAt: group.updatedAt.toISOString(),
});
const variantResponse = (variant: ProductVariant) => ({
  ...variant,
  priceAdjustment: variant.priceAdjustment.toFixed(2),
  createdAt: variant.createdAt.toISOString(),
  updatedAt: variant.updatedAt.toISOString(),
});

@Injectable()
export class ProductVariantsService {
  constructor(
    private readonly repository: ProductVariantsRepository,
    private readonly members: ShopMembersService,
    private readonly resources: TenantResourcesService,
  ) {}
  private async authorize(userId: string, shopId: string, productId: string) {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    await this.resources.requireResource(userId, shopId, 'product', productId);
  }
  private async write<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002')
          throw new ConflictException({
            code: 'VARIANT_CHOICE_CONFLICT',
            message:
              'A choice with this name or a default choice already exists in this group.',
          });
        // Protect against a concurrent change between the validation read and write.
        if (
          JSON.stringify(error.meta ?? {}).includes(
            'product_variants_default_base_price',
          )
        )
          throw new BadRequestException({
            code: 'DEFAULT_VARIANT_MUST_USE_BASE_PRICE',
            message: 'A base/default option must have a zero price adjustment.',
          });
        if (['P2025', 'P2003'].includes(error.code))
          throw new NotFoundException({
            code: 'RESOURCE_NOT_ACCESSIBLE',
            message:
              'The product, variant or option group is unavailable in this shop, or your access changed.',
          });
      }
      throw error;
    }
  }
  private nonempty(dto: object) {
    if (Object.values(dto).every((value) => value === undefined))
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Provide at least one field to update.',
      });
  }
  private validateDefault(
    isDefault: boolean | undefined,
    priceAdjustment: string | Prisma.Decimal,
  ) {
    if (isDefault && !new Prisma.Decimal(priceAdjustment).isZero())
      throw new BadRequestException({
        code: 'DEFAULT_VARIANT_MUST_USE_BASE_PRICE',
        message: 'A base/default option must have a zero price adjustment.',
        fieldErrors: {
          priceAdjustment: ['Use 0.00 for the base/default option.'],
        },
      });
  }
  async createRegular(
    userId: string,
    shopId: string,
    productId: string,
    dto: CreateRegularVariantDto,
  ) {
    return this.createVariant(userId, shopId, productId, {
      name: 'Regular',
      priceAdjustment: '0.00',
      isDefault: true,
      isAvailable: true,
      optionGroupId: dto.optionGroupId,
      sortOrder: dto.sortOrder ?? 0,
    });
  }
  async createLarge(
    userId: string,
    shopId: string,
    productId: string,
    dto: CreateLargeVariantDto,
  ) {
    await this.authorize(userId, shopId, productId);
    if (!new Prisma.Decimal(dto.priceAdjustment).greaterThan(0))
      throw new BadRequestException({
        code: 'LARGE_VARIANT_REQUIRES_SURCHARGE',
        message: 'Large must add a positive amount to the base product price.',
        fieldErrors: {
          priceAdjustment: ['Use an additional price of at least 0.01.'],
        },
      });
    return this.createVariant(userId, shopId, productId, {
      name: 'Large',
      priceAdjustment: dto.priceAdjustment,
      isDefault: false,
      isAvailable: true,
      optionGroupId: dto.optionGroupId,
      sortOrder: dto.sortOrder ?? 1,
    });
  }
  async list(
    userId: string,
    shopId: string,
    productId: string,
  ): Promise<ProductVariantsResponse> {
    await this.authorize(userId, shopId, productId);
    const result = await this.repository.list(userId, shopId, productId);
    if (!result)
      throw new NotFoundException({
        code: 'RESOURCE_NOT_ACCESSIBLE',
        message: 'This product is unavailable in this shop.',
      });
    return {
      optionGroups: result.optionGroups.map(groupResponse),
      variants: result.variants.map(variantResponse),
    };
  }
  async createGroup(
    userId: string,
    shopId: string,
    productId: string,
    dto: CreateProductOptionGroupDto,
  ) {
    await this.authorize(userId, shopId, productId);
    return this.write(async () => ({
      optionGroup: groupResponse(
        (await this.repository.createGroup(userId, shopId, productId, dto))
          .optionGroups[0],
      ),
    }));
  }
  async createVariant(
    userId: string,
    shopId: string,
    productId: string,
    dto: CreateProductVariantDto,
  ) {
    await this.authorize(userId, shopId, productId);
    this.validateDefault(dto.isDefault, dto.priceAdjustment);
    return this.write(async () => ({
      variant: variantResponse(
        (await this.repository.createVariant(userId, shopId, productId, dto))
          .variants[0],
      ),
    }));
  }
  async updateGroup(
    userId: string,
    shopId: string,
    productId: string,
    id: string,
    dto: UpdateProductOptionGroupDto,
  ) {
    await this.authorize(userId, shopId, productId);
    this.nonempty(dto);
    return this.write(async () => ({
      optionGroup: groupResponse(
        await this.repository.updateGroup(userId, shopId, productId, id, dto),
      ),
    }));
  }
  async updateVariant(
    userId: string,
    shopId: string,
    productId: string,
    id: string,
    dto: UpdateProductVariantDto,
  ) {
    await this.authorize(userId, shopId, productId);
    this.nonempty(dto);
    const existing = await this.repository.findVariant(
      userId,
      shopId,
      productId,
      id,
    );
    if (!existing)
      throw new NotFoundException({
        code: 'RESOURCE_NOT_ACCESSIBLE',
        message: 'This variant is unavailable in this shop.',
      });
    this.validateDefault(
      dto.isDefault ?? existing.isDefault,
      dto.priceAdjustment ?? existing.priceAdjustment,
    );
    return this.write(async () => ({
      variant: variantResponse(
        await this.repository.updateVariant(userId, shopId, productId, id, dto),
      ),
    }));
  }
}
