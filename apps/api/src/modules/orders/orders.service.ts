import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PRODUCT_CURRENCY,
  type CustomerOrderResponse,
} from '@paserve/contracts';
import { Prisma, type Order } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PublicProductService } from '../products/public-product.service.js';
import { CreateOrderDto } from './create-order.dto.js';
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
    dto: CreateOrderDto,
  ): Promise<CustomerOrderResponse> {
    const mode = dto.mode ?? 'DINE_IN';
    const unavailable = () =>
      new NotFoundException({
        code: mode === 'TAKEOUT' ? 'SHOP_NOT_AVAILABLE' : 'TABLE_NOT_AVAILABLE',
        message:
          mode === 'TAKEOUT'
            ? 'This shop is unavailable for pickup.'
            : 'This table is unavailable. Scan an active table QR again.',
      });
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$(?![\s\S])/.test(slug) || slug.length > 100)
      throw unavailable();
    if (mode === 'TAKEOUT') {
      if (dto.tableCode !== undefined || dto.tableToken !== undefined)
        throw new BadRequestException({
          code: 'TAKEOUT_TABLE_NOT_ALLOWED',
          message: 'Takeout orders must not include a table.',
        });
    } else {
      if (!dto.tableCode || !dto.tableToken)
        throw new BadRequestException({
          code: 'TABLE_REQUIRED',
          message: 'Dine-in orders require a valid table context.',
        });
      // An expired but authentic context may confirm a previously created order.
      this.contexts.verify(dto.tableToken, slug, dto.tableCode, true);
    }
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          mode,
          ...(mode === 'DINE_IN' ? { tableCode: dto.tableCode } : {}),
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
    const response = (order: Order): CustomerOrderResponse => {
      if (order.requestHash !== hash)
        throw new ConflictException({
          code: 'ORDER_REQUEST_CONFLICT',
          message: 'This request ID was already used for another order.',
        });
      if (order.status !== 'PENDING')
        throw new Error('Invalid persisted order status.');
      const common = {
        id: order.id,
        status: 'PENDING' as const,
        currency: PRODUCT_CURRENCY,
        totalPrice: order.totalPrice.toFixed(2),
        items:
          order.items as unknown as CustomerOrderResponse['order']['items'],
        createdAt: order.createdAt.toISOString(),
      };
      if (order.mode === 'TAKEOUT')
        return { order: { ...common, mode: 'TAKEOUT', table: null } };
      if (!order.tableCode || !order.tableNumber || !order.tableId)
        throw new Error('Invalid persisted dine-in table binding.');
      return {
        order: {
          ...common,
          mode: 'DINE_IN',
          table: {
            shopSlug: slug,
            code: order.tableCode,
            number: order.tableNumber,
          },
        },
      };
    };
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Lock shop/table state until commit; pauses or deactivation cannot slip between resolution and insert.
          const shops = await tx.$queryRaw<
            { id: string; isActive: boolean; acceptingOrders: boolean }[]
          >`SELECT "id", "isActive", "acceptingOrders" FROM "shops" WHERE "slug" = ${slug} FOR SHARE`;
          const shop = shops[0];
          if (!shop) throw unavailable();
          const saved = await tx.order.findUnique({
            where: {
              shopId_requestId: { shopId: shop.id, requestId: dto.requestId },
            },
          });
          if (saved) return response(saved);
          if (!shop.isActive) throw unavailable();
          if (!shop.acceptingOrders)
            throw new ConflictException({
              code: 'SHOP_NOT_ACCEPTING_ORDERS',
              message:
                'This shop is temporarily not accepting orders. Please try again later.',
            });
          let table: { id: string; number: string } | undefined;
          if (mode === 'DINE_IN') {
            this.contexts.verify(dto.tableToken!, slug, dto.tableCode!);
            const tables = await tx.$queryRaw<
              { id: string; number: string }[]
            >`SELECT "id", "number" FROM "restaurant_tables" WHERE "shopId" = ${shop.id} AND "code" = ${dto.tableCode} AND "isActive" = true FOR SHARE`;
            table = tables[0];
            if (!table) throw unavailable();
          }
          const items = [];
          for (const item of dto.items)
            items.push(
              await this.products.quote(
                slug,
                item.productId,
                {
                  variantIds: [...item.variantIds],
                  addOnIds: [...item.addOnIds],
                  quantity: item.quantity,
                  ...(item.notes !== undefined ? { notes: item.notes } : {}),
                },
                tx,
              ),
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
              tableId: table?.id ?? null,
              requestId: dto.requestId,
              requestHash: hash,
              mode,
              status: 'PENDING',
              tableCode: mode === 'DINE_IN' ? dto.tableCode : null,
              tableNumber: table?.number ?? null,
              currency: PRODUCT_CURRENCY,
              totalPrice: total,
              items: items as unknown as Prisma.InputJsonValue,
            },
          });
          return response(order);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30_000,
        },
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
