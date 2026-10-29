import { OrderPriceChangedException } from '../../common/http/order-price-changed.exception.js';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PRODUCT_CURRENCY,
  ORDER_INPUT_LIMITS,
  isValidOrderService,
  isValidProductSelection,
  type CustomerOrderResponse,
} from '@paserve/contracts';
import { Prisma, type Order } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PublicProductService } from '../products/public-product.service.js';
import { CreateOrderDto } from './create-order.dto.js';
import { TableContextService } from '../tables/table-context.service.js';
import { OrderTokenService } from './order-token.service.js';
import { formatOrderNumber } from './order-number.js';
import { readReceiptShopDetails } from './receipt-shop-details.js';
import {
  copyPriceSnapshot,
  readPriceSnapshot,
} from './order-price-snapshots.js';

/** Internal checkout result; the controller moves proof into an HttpOnly cookie. */
type CreatedGuestOrder = CustomerOrderResponse & { trackingToken: string };

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: PublicProductService,
    private readonly contexts: TableContextService,
    private readonly tokens: OrderTokenService,
  ) {}

  async create(slug: string, dto: CreateOrderDto): Promise<CreatedGuestOrder> {
    if (
      !dto ||
      !isUUID(dto.requestId, '4') ||
      !Array.isArray(dto.items) ||
      !dto.items.length ||
      dto.items.length > ORDER_INPUT_LIMITS.linesMax ||
      !Array.from(dto.items).every(isValidProductSelection) ||
      !isValidOrderService(dto.mode ?? 'DINE_IN', dto.serviceType) ||
      (dto.reviewedTotal !== undefined &&
        (typeof dto.reviewedTotal !== 'string' ||
          !/^(?:0|[1-9]\d{0,9})\.\d{2}$(?![\s\S])/.test(dto.reviewedTotal))) ||
      (dto.mode !== undefined &&
        dto.mode !== 'DINE_IN' &&
        dto.mode !== 'TAKEOUT')
    )
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Provide valid order items and order mode.',
      });
    const requestId = dto.requestId.toLowerCase();
    const mode = dto.mode ?? 'DINE_IN';
    const serviceType =
      mode === 'DINE_IN' ? (dto.serviceType ?? 'TABLE_SERVICE') : null;
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
          // Preserve pre-feature request hashes for table service and takeout retries.
          ...(serviceType === 'COUNTER_PICKUP' ? { serviceType } : {}),
          ...(dto.reviewedTotal !== undefined
            ? { reviewedTotal: dto.reviewedTotal }
            : {}),
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
    ): Promise<CreatedGuestOrder> => {
      if (order.requestHash !== hash)
        throw new ConflictException({
          code: 'ORDER_REQUEST_CONFLICT',
          message: 'This request ID was already used for another order.',
        });
      if (['CONFIRMED', 'REJECTED'].includes(order.status))
        throw new ConflictException({
          code: 'ORDER_ALREADY_PROCESSED',
          message:
            'This order has already been processed at the counter. Ask the staff for its current status before placing another order.',
        });
      if (order.status !== 'PENDING_CONFIRMATION')
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
        shopDetails: readReceiptShopDetails(order.shopDetailsSnapshot),
        status: 'PENDING_CONFIRMATION' as const,
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
        return {
          trackingToken: this.tokens.issueTracking(order),
          order: { ...common, mode: 'TAKEOUT', serviceType: null, table: null },
        };
      if (!order.tableCode || !order.tableNumber || !order.tableId)
        throw new Error('Invalid persisted dine-in table binding.');
      return {
        trackingToken: this.tokens.issueTracking(order),
        order: {
          ...common,
          mode: 'DINE_IN',
          serviceType: order.serviceType ?? 'TABLE_SERVICE',
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
          // The counter will require a write lock. Acquire it now to avoid
          // shared-lock upgrade deadlocks between concurrent submissions.
          // Shop/table state stays locked until commit.
          const shops = await tx.$queryRaw<
            {
              id: string;
              isActive: boolean;
              acceptingOrders: boolean;
              dineInServiceMode: string;
              name: string;
              displayName: string | null;
              address: string | null;
              phone: string | null;
              contactEmail: string | null;
              website: string | null;
            }[]
          >`SELECT "id", "isActive", "acceptingOrders", "dineInServiceMode", "name", "displayName", "address", "phone", "contactEmail", "website" FROM "shops" WHERE "slug" = ${slug} FOR UPDATE`;
          const shop = shops[0];
          if (!shop) throw unavailable();
          // Uses the SQL-maintained expression index and also finds historical
          // mixed-case UUID keys without rewriting their receipt or timestamps.
          const [saved] = await tx.$queryRaw<Order[]>`SELECT * FROM orders
            WHERE "shopId" = ${shop.id} AND lower("requestId") = ${requestId} LIMIT 1`;
          if (saved) return response(saved, tx);
          if (!shop.isActive) throw unavailable();
          if (
            mode === 'DINE_IN' &&
            shop.dineInServiceMode &&
            shop.dineInServiceMode !== 'BOTH' &&
            shop.dineInServiceMode !== serviceType
          )
            throw new ConflictException({
              code: 'SERVICE_TYPE_NOT_AVAILABLE',
              message:
                'This dine-in service option is no longer available. Refresh the menu and review your order again.',
            });
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
          // Keep the existing early all-identity availability check. This is
          // one bounded query, independent of the number of submitted lines.
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
          // Batch product/options reads inside this same serializable checkout
          // transaction. Every selected identity remains bound to the live shop.
          const items = (
            await this.products.quoteMany(slug, dto.items, tx)
          ).map(copyPriceSnapshot);
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
          // Compare within the same transaction that prices and creates the order.
          // Never trust the browser's amount as a price source or silently change it.
          if (
            dto.reviewedTotal !== undefined &&
            !total.equals(dto.reviewedTotal)
          )
            throw new OrderPriceChangedException({
              currency: PRODUCT_CURRENCY,
              totalPrice: total.toFixed(2),
              items,
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
              requestId,
              requestHash: hash,
              mode,
              serviceType,
              status: 'PENDING_CONFIRMATION',
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
              shopDetailsSnapshot: {
                name: shop.displayName?.trim() || shop.name,
                address: shop.address?.trim() || null,
                phone: shop.phone?.trim() || null,
                contactEmail: shop.contactEmail?.trim() || null,
                website: shop.website?.trim() || null,
              },
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
      // Prisma's pg adapter can report the PostgreSQL SQLSTATE in the cause
      // instead of meta.code for raw row-lock serialization failures.
      const adapterCause =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? (
              error.meta?.driverAdapterError as
                { cause?: { originalCode?: string } } | undefined
            )?.cause
          : undefined;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (['P2002', 'P2034'].includes(error.code) ||
          (error.code === 'P2010' &&
            [error.meta?.code, adapterCause?.originalCode].some((state) =>
              ['40001', '40P01'].includes(String(state)),
            )))
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
