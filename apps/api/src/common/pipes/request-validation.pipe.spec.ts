import { EmptyDto } from '../../modules/auth/dto/empty.dto.js';
import { BadRequestException } from '@nestjs/common';
import { requestValidationPipe } from './request-validation.pipe.js';
import { CreateOrderDto } from '../../modules/orders/create-order.dto.js';
import { CreateProductDto } from '../../modules/products/create-product.dto.js';
import { CreateCategoryDto } from '../../modules/categories/create-category.dto.js';
import { CreateProductVariantDto } from '../../modules/products/product-variants.dto.js';
import { UpdateProductDto } from '../../modules/products/update-product.dto.js';

const id = '00000000-0000-4000-8000-000000000001';
const line = { productId: id, quantity: 1, variantIds: [], addOnIds: [] };
const transform = (
  body: unknown,
  metatype:
    | typeof CreateOrderDto
    | typeof CreateProductDto
    | typeof CreateCategoryDto
    | typeof CreateProductVariantDto
    | typeof UpdateProductDto,
) => requestValidationPipe().transform(body, { type: 'body', metatype });

describe('request validation boundaries', () => {
  it('supports cookie-only empty bodies and still rejects body injection', async () => {
    const pipe = requestValidationPipe();
    await expect(
      pipe.transform({}, { type: 'body', metatype: EmptyDto }),
    ).resolves.toEqual({});
    await expect(
      pipe.transform(
        { token: 'injected' },
        { type: 'body', metatype: EmptyDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('returns actionable nested paths without exposing submitted values', async () => {
    try {
      await transform(
        {
          requestId: id,
          mode: 'TAKEOUT',
          items: [{ ...line, quantity: '2', price: 'secret-value' }],
        },
        CreateOrderDto,
      );
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse();
      expect(response).toMatchObject({
        code: 'VALIDATION_ERROR',
        fieldErrors: {
          'items.0.quantity': expect.arrayContaining([expect.any(String)]),
          'items.0.price': expect.arrayContaining([expect.any(String)]),
        },
      });
      expect(JSON.stringify(response)).not.toContain('secret-value');
    }
  });
  it.each([
    null,
    [],
    'order',
    { requestId: id, mode: 'TAKEOUT', items: [null] },
    { requestId: id, mode: 'TAKEOUT', items: [line], shopId: id },
    { requestId: id, mode: 'TAKEOUT', items: [{ ...line, quantity: true }] },
    { requestId: id, mode: 'TAKEOUT', items: [{ ...line, notes: null }] },
  ])(
    'rejects malformed orders, unknown fields and implicit conversions: %j',
    async (body) => {
      await expect(transform(body, CreateOrderDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );
  it.each(['Coffee\n', '\tCoffee', 'Coffee\u0000', 'Coffee\ud800'])(
    'does not erase forbidden name input: %j',
    async (name) => {
      for (const metatype of [
        CreateCategoryDto,
        CreateProductDto,
        CreateProductVariantDto,
      ]) {
        const extra =
          metatype === CreateProductDto
            ? { price: '1.00' }
            : metatype === CreateProductVariantDto
              ? { priceAdjustment: '1.00' }
              : {};
        await expect(
          transform({ name, ...extra }, metatype),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    },
  );
  it('accepts Unicode names at the code-point boundary and normalizes spaces', async () => {
    expect(
      await transform({ name: '  Cold   brew  ' }, CreateCategoryDto),
    ).toMatchObject({ name: 'Cold brew' });
    await expect(
      transform({ name: '\u2615'.repeat(80) }, CreateCategoryDto),
    ).resolves.toBeDefined();
    await expect(
      transform({ name: '\u{1f600}'.repeat(80) }, CreateCategoryDto),
    ).resolves.toBeDefined();
    await expect(
      transform({ name: '\u{1f600}'.repeat(81) }, CreateCategoryDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each(['1.00\n', '1e2', '-1', '1.001', 1.25])(
    'rejects inexact or malformed catalog money: %j',
    async (price) => {
      await expect(
        transform({ name: 'Coffee', price }, CreateProductDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it('allows explicit category clearing but rejects null prices and names', async () => {
    await expect(
      transform({ categoryId: null }, UpdateProductDto),
    ).resolves.toMatchObject({ categoryId: null });
    await expect(
      transform({ price: null }, UpdateProductDto),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      transform({ name: null }, UpdateProductDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
