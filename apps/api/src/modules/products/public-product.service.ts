import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PRODUCT_CURRENCY,
  normalizeCustomerNote,
  type PublicProductDetailsResponse,
  type ProductSelectionQuoteResponse,
} from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { PublicProductRepository } from './public-product.repository.js';
import type { ProductSelectionDto } from './public-product.dto.js';

const unavailable = () =>
  new NotFoundException({
    code: 'PRODUCT_NOT_AVAILABLE',
    message: 'This product is unavailable.',
  });
@Injectable()
export class PublicProductService {
  constructor(private readonly repository: PublicProductRepository) {}
  private async read(slug: string, productId: string) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100)
      throw unavailable();
    const result = await this.repository.read(slug, productId);
    if (!result) throw unavailable();
    return result;
  }
  async details(
    slug: string,
    productId: string,
  ): Promise<PublicProductDetailsResponse> {
    const { optionGroups, variants, addOns, ...product } = await this.read(
      slug,
      productId,
    );
    return {
      product: {
        id: product.id,
        categoryId: product.categoryId,
        name: product.name,
        slug: product.slug,
        description: product.description,
        imageUrl: product.imageUrl,
        isFeatured: product.isFeatured,
        sortOrder: product.sortOrder,
        featuredSortOrder: product.featuredSortOrder,
        price: product.price.toFixed(2),
        status: product.status as 'AVAILABLE' | 'SOLD_OUT',
        isOrderable: product.status === 'AVAILABLE',
      },
      optionGroups: optionGroups.map((group) => ({
        id: group.id,
        name: group.name,
        isRequired: group.isRequired,
      })),
      variants: variants.map((variant) => ({
        id: variant.id,
        optionGroupId: variant.optionGroupId,
        name: variant.name,
        isDefault: variant.isDefault,
        priceAdjustment: variant.priceAdjustment.toFixed(2),
      })),
      addOns: addOns.map(({ addOn }) => ({
        id: addOn.id,
        name: addOn.name,
        priceAdjustment: addOn.priceAdjustment.toFixed(2),
      })),
    };
  }
  async quote(
    slug: string,
    productId: string,
    dto: ProductSelectionDto,
  ): Promise<ProductSelectionQuoteResponse> {
    const details = await this.details(slug, productId);
    if (!details.product.isOrderable) throw unavailable();
    const invalid = () =>
      new BadRequestException({
        code: 'PRODUCT_SELECTION_INVALID',
        message:
          'Choose available options for this product and complete all required choices.',
      });
    const variants = dto.variantIds.map((id) =>
      details.variants.find((variant) => variant.id === id),
    );
    const addOns = dto.addOnIds.map((id) =>
      details.addOns.find((addOn) => addOn.id === id),
    );
    if (
      new Set(dto.variantIds).size !== dto.variantIds.length ||
      new Set(dto.addOnIds).size !== dto.addOnIds.length ||
      variants.some((value) => !value) ||
      addOns.some((value) => !value)
    )
      throw invalid();
    const chosenVariants = variants.filter((value) => value !== undefined);
    const chosenAddOns = addOns.filter((value) => value !== undefined);
    const groups = chosenVariants.map((variant) => variant.optionGroupId);
    if (
      new Set(groups).size !== groups.length ||
      details.optionGroups.some(
        (group) => group.isRequired && !groups.includes(group.id),
      )
    )
      throw invalid();
    const unitPrice = [...chosenVariants, ...chosenAddOns].reduce(
      (sum, option) => sum.plus(option.priceAdjustment),
      new Prisma.Decimal(details.product.price),
    );
    return {
      productId,
      productName: details.product.name,
      currency: PRODUCT_CURRENCY,
      basePrice: details.product.price,
      unitPrice: unitPrice.toFixed(2),
      totalPrice: unitPrice.times(dto.quantity).toFixed(2),
      quantity: dto.quantity,
      ...(normalizeCustomerNote(dto.notes ?? '')
        ? { notes: normalizeCustomerNote(dto.notes ?? '') }
        : {}),
      variants: chosenVariants,
      addOns: chosenAddOns,
    };
  }
}
