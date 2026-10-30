import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  ADD_ON_LIMITS,
  ORDER_INPUT_LIMITS,
  isValidProductSelection,
  PRODUCT_CURRENCY,
  normalizeCustomerNote,
  type PublicProductDetailsResponse,
  type ProductSelectionQuoteResponse,
} from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { PublicProductRepository } from './public-product.repository.js';
import type { ProductSelectionDto } from './public-product.dto.js';
import { PublicMenuReadGate } from '../categories/public-menu-read-gate.js';

type PricingDetails = {
  product: Pick<
    PublicProductDetailsResponse['product'],
    'name' | 'price' | 'isOrderable'
  >;
  optionGroups: Array<
    Pick<
      PublicProductDetailsResponse['optionGroups'][number],
      'id' | 'isRequired'
    >
  >;
  variants: PublicProductDetailsResponse['variants'];
  addOns: PublicProductDetailsResponse['addOns'];
};

const unavailable = () =>
  new NotFoundException({
    code: 'PRODUCT_NOT_AVAILABLE',
    message:
      'This product is unavailable. Refresh the menu and update your cart before ordering again.',
  });
@Injectable()
export class PublicProductService {
  constructor(
    private readonly repository: PublicProductRepository,
    @Optional()
    private readonly gate: PublicMenuReadGate = new PublicMenuReadGate(),
  ) {}
  private async read(
    slug: string,
    productId: string,
    db?: Prisma.TransactionClient,
  ) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100)
      throw unavailable();
    const result = await this.repository.read(slug, productId, db);
    if (!result) throw unavailable();
    return result;
  }
  async details(
    slug: string,
    productId: string,
    db?: Prisma.TransactionClient,
  ): Promise<PublicProductDetailsResponse> {
    return this.gate.run(async () =>
      this.serializeDetails(await this.read(slug, productId, db)),
    );
  }
  private serializeDetails(
    record: NonNullable<Awaited<ReturnType<PublicProductRepository['read']>>>,
  ): PublicProductDetailsResponse {
    const { optionGroups, variants, addOns, ...product } = record;
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
    db?: Prisma.TransactionClient,
  ): Promise<ProductSelectionQuoteResponse> {
    if (!isValidProductSelection(dto))
      throw new BadRequestException({
        code: 'PRODUCT_SELECTION_INVALID',
        message: 'Choose valid quantities, options and notes for this product.',
      });
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100)
      throw unavailable();
    const record = await this.repository.readPricing(slug, productId, db);
    if (!record) throw unavailable();
    return this.quoteDetails(this.serializePricing(record), productId, dto);
  }

  async quoteMany(
    slug: string,
    lines: Array<ProductSelectionDto & { productId: string }>,
    db?: Prisma.TransactionClient,
  ): Promise<ProductSelectionQuoteResponse[]> {
    if (
      !Array.isArray(lines) ||
      !lines.length ||
      lines.length > ORDER_INPUT_LIMITS.linesMax ||
      lines.some((line) => !line || !isValidProductSelection(line))
    )
      throw new BadRequestException({
        code: 'PRODUCT_SELECTION_INVALID',
        message:
          'Choose valid quantities, options and notes for these products.',
      });
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100)
      throw unavailable();
    const records = await this.repository.readMany(
      slug,
      [...new Set(lines.map((line) => line.productId))],
      db,
    );
    const details = new Map(
      records.map((record) => [record.id, this.serializePricing(record)]),
    );
    // Request-local data only. Repeated products may have different selections,
    // quantities and notes; reprice every line without additional database reads.
    return lines.map((line) => {
      const detail = details.get(line.productId);
      if (!detail) throw unavailable();
      return this.quoteDetails(detail, line.productId, line);
    });
  }

  private serializePricing(
    record: Awaited<ReturnType<PublicProductRepository['readMany']>>[number],
  ): PricingDetails {
    return {
      product: {
        name: record.name,
        price: record.price.toFixed(2),
        isOrderable: record.status === 'AVAILABLE',
      },
      optionGroups: record.optionGroups.map((group) => ({
        id: group.id,
        isRequired: group.isRequired,
      })),
      variants: record.variants.map((variant) => ({
        id: variant.id,
        optionGroupId: variant.optionGroupId,
        name: variant.name,
        isDefault: variant.isDefault,
        priceAdjustment: variant.priceAdjustment.toFixed(2),
      })),
      addOns: record.addOns.map(({ addOn }) => ({
        id: addOn.id,
        name: addOn.name,
        priceAdjustment: addOn.priceAdjustment.toFixed(2),
      })),
    };
  }

  private quoteDetails(
    details: PricingDetails,
    productId: string,
    dto: ProductSelectionDto,
  ): ProductSelectionQuoteResponse {
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
    // Only current variants returned by the product/shop-scoped repository are eligible.
    if (
      new Set(dto.variantIds).size !== dto.variantIds.length ||
      variants.some((value) => !value)
    )
      throw invalid();
    const chosenVariants = variants.filter((value) => value !== undefined);
    const groups = chosenVariants.map((variant) => variant.optionGroupId);
    if (
      new Set(groups).size !== groups.length ||
      groups.some(
        (id) =>
          id !== null && !details.optionGroups.some((group) => group.id === id),
      ) ||
      details.optionGroups.some(
        (group) => group.isRequired && !groups.includes(group.id),
      )
    )
      throw invalid();
    // The eligible set contains only available add-ons assigned to this product/shop.
    const addOns = dto.addOnIds.map((id) =>
      details.addOns.find((addOn) => addOn.id === id),
    );
    if (
      dto.addOnIds.length > ADD_ON_LIMITS.selectionMax ||
      new Set(dto.addOnIds).size !== dto.addOnIds.length ||
      addOns.some((value) => !value)
    )
      throw invalid();
    const chosenAddOns = addOns.filter((value) => value !== undefined);
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
