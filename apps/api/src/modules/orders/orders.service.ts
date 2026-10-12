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
import { OrderTokenService } from './order-token.service.js';
import { formatOrderNumber } from './order-number.js';
import {
  copyPriceSnapshot,
  readPriceSnapshot,
} from './order-price-snapshots.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: PublicProductService,
    private readonly contexts: TableContextService,
    private readonly tokens: OrderTokenService,
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
    const response = async (
      order: Order,
      tx: Prisma.TransactionClient,
    ): Promise<CustomerOrderResponse> => {
      if (order.requestHash !== hash)
        throw new ConflictException({
          code: 'ORDER_REQUEST_CONFLICT',
          message: 'This request ID was already used for another order.',
        });
      if (order.status !== 'PENDING')
        throw new Error('Invalid persisted order status.');
      if (order.paymentStatus !== 'UNPAID')
        throw new Error('Invalid persisted payment status.');
      const savedItems = await tx.orderItem.findMany({
        where: { shopId: order.shopId, orderId: order.id },
        orderBy: { lineNumber: 'asc' },
      });
      if (
        savedItems.length !== dto.items.length ||
        savedItems.some((item, index) => item.lineNumber !== index + 1)
      )
        throw new Error('Invalid persisted receipt lines.');
      const receiptItems = savedItems.map(readPriceSnapshot);
      if (
        !receiptItems
          .reduce(
            (sum, item) => sum.plus(item.totalPrice),
            new Prisma.Decimal(0),
          )
          .equals(order.totalPrice)
      )
        throw new Error('Invalid persisted receipt total.');
      const common = {
        id: order.id,
        status: 'PENDING' as const,
        paymentStatus: 'UNPAID' as const,
        orderNumber: order.orderNumber,
        qrToken: this.tokens.issue(order),
        qrTokenExpiresAt: order.qrTokenExpiresAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        currency: PRODUCT_CURRENCY,
        // No order-level adjustments are modeled; the saved total is also the subtotal.
        subtotalPrice: order.totalPrice.toFixed(2),
        totalPrice: order.totalPrice.toFixed(2),
        items: receiptItems,
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
          if (saved) return response(saved, tx);
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
          // Resolve all product identities in the validated tenant before pricing any line.
          const productIds = [
            ...new Set(dto.items.map((item) => item.productId)),
          ];
          const submittedProducts = await tx.product.findMany({
            where: { shopId: shop.id, id: { in: productIds } },
            select: { id: true, status: true, isArchived: true },
          });
          const foundIds = new Set(
            submittedProducts.map((product) => product.id),
          );
          if (
            productIds.some((id) => !foundIds.has(id)) ||
            submittedProducts.some(
              (product) => product.status !== 'AVAILABLE' || product.isArchived,
            )
          )
            throw new NotFoundException({
              code: 'PRODUCT_NOT_AVAILABLE',
              message:
                'This product is unavailable. Refresh the menu and update your cart before ordering again.',
            });
          const items = [];
          for (const item of dto.items)
            items.push(
              copyPriceSnapshot(
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
              ),
            );
          const subtotal = items.reduce(
            (sum, item) => sum.plus(item.totalPrice),
            new Prisma.Decimal(0),
          );
          const total = subtotal;
          if (total.greaterThan('9999999999.99'))
            throw new BadRequestException({
              code: 'ORDER_TOTAL_TOO_LARGE',
              message:
                'This order total is too large. Reduce the quantities and try again.',
            });
          const numbering = await tx.shop.update({
            where: { id: shop.id, isActive: true, acceptingOrders: true },
            data: { lastOrderNumber: { increment: 1 } },
            select: { lastOrderNumber: true },
          });
          const createdAt = new Date();
          const order = await tx.order.create({
            data: {
              shopId: shop.id,
              tableId: table?.id ?? null,
              requestId: dto.requestId,
              requestHash: hash,
              mode,
              status: 'PENDING',
              paymentStatus: 'UNPAID',
              orderNumber: formatOrderNumber(numbering.lastOrderNumber),
              ...this.tokens.metadata(),
              qrTokenRevokedAt: null,
              createdAt,
              updatedAt: createdAt,
              tableCode: mode === 'DINE_IN' ? dto.tableCode : null,
              tableNumber: table?.number ?? null,
              currency: PRODUCT_CURRENCY,
              totalPrice: total,
              items: items as unknown as Prisma.InputJsonValue,
            },
          });
          const inserted = await tx.orderItem.createMany({
            data: items.map((item, index) => ({
              shopId: shop.id,
              orderId: order.id,
              productId: item.productId,
              lineNumber: index + 1,
              quantity: item.quantity,
              notes: item.notes ?? null,
              snapshot: item as unknown as Prisma.InputJsonValue,
              productSnapshotId: item.productId,
              productNameSnapshot: item.productName,
              currency: item.currency,
              basePriceSnapshot: new Prisma.Decimal(item.basePrice),
              unitPriceSnapshot: new Prisma.Decimal(item.unitPrice),
              lineTotalSnapshot: new Prisma.Decimal(item.totalPrice),
              variantsSnapshot:
                item.variants as unknown as Prisma.InputJsonValue,
              addOnsSnapshot: item.addOns as unknown as Prisma.InputJsonValue,
              createdAt,
            })),
          });
          if (inserted.count !== items.length)
            throw new Error('Incomplete persisted order items.');
          return response(order, tx);
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
