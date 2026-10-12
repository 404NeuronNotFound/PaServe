import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PRODUCT_CURRENCY, type DineInOrderResponse } from '@paserve/contracts';
import { Prisma, type Order } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PublicProductService } from '../products/public-product.service.js';
import { CreateDineInOrderDto } from './create-dine-in-order.dto.js';
import { TableContextService } from '../tables/table-context.service.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: PublicProductService,
    private readonly contexts: TableContextService,
  ) {}

  async create(
    slug: string,
    dto: CreateDineInOrderDto,
  ): Promise<DineInOrderResponse> {
    const unavailable = () =>
      new NotFoundException({
        code: 'TABLE_NOT_AVAILABLE',
        message: 'This table is unavailable. Scan an active table QR again.',
      });
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$(?![\s\S])/.test(slug) || slug.length > 100)
      throw unavailable();
    this.contexts.verify(dto.tableToken, slug, dto.tableCode);
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          mode: 'DINE_IN',
          tableCode: dto.tableCode,
          items: dto.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            variantIds: [...item.variantIds].sort(),
            addOnIds: [...item.addOnIds].sort(),
            notes: item.notes ?? '',
          })),
        }),
      )
      .digest('hex');
    const response = (order: Order): DineInOrderResponse => {
      if (order.requestHash !== hash)
        throw new ConflictException({
          code: 'ORDER_REQUEST_CONFLICT',
          message: 'This request ID was already used for another order.',
        });
      return {
        order: {
          id: order.id,
          mode: 'DINE_IN',
          status: 'PLACED',
          table: {
            shopSlug: slug,
            code: order.tableCode,
            number: order.tableNumber,
          },
          currency: PRODUCT_CURRENCY,
          totalPrice: order.totalPrice.toFixed(2),
          items:
            order.items as unknown as DineInOrderResponse['order']['items'],
          createdAt: order.createdAt.toISOString(),
        },
      };
    };
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Lock shop/table state until commit; deactivation cannot slip between resolution and insert.
          const shops = await tx.$queryRaw<
            { id: string }[]
          >`SELECT "id" FROM "shops" WHERE "slug" = ${slug} AND "isActive" = true FOR SHARE`;
          const shop = shops[0];
          if (!shop) throw unavailable();
          const saved = await tx.order.findUnique({
            where: {
              shopId_requestId: { shopId: shop.id, requestId: dto.requestId },
            },
          });
          if (saved) return response(saved);
          const tables = await tx.$queryRaw<
            { id: string; number: string }[]
          >`SELECT "id", "number" FROM "restaurant_tables" WHERE "shopId" = ${shop.id} AND "code" = ${dto.tableCode} AND "isActive" = true FOR SHARE`;
          const table = tables[0];
          if (!table) throw unavailable();
          const items = [];
          for (const item of dto.items)
            items.push(
              await this.products.quote(slug, item.productId, item, tx),
            );
          const total = items.reduce(
            (sum, item) => sum.plus(item.totalPrice),
            new Prisma.Decimal(0),
          );
          if (total.greaterThan('9999999999.99'))
            throw new BadRequestException({
              code: 'ORDER_TOTAL_TOO_LARGE',
              message:
                'This order total is too large. Reduce the quantities and try again.',
            });
          const order = await tx.order.create({
            data: {
              shopId: shop.id,
              tableId: table.id,
              requestId: dto.requestId,
              requestHash: hash,
              mode: 'DINE_IN',
              tableCode: dto.tableCode,
              tableNumber: table.number,
              currency: PRODUCT_CURRENCY,
              totalPrice: total,
              items: items as unknown as Prisma.InputJsonValue,
            },
          });
          return response(order);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        throw new ConflictException({
          code: 'ORDER_RETRY_REQUIRED',
          message: 'Retry with the same request ID to confirm your order.',
        });
      }
      throw error;
    }
  }
}
