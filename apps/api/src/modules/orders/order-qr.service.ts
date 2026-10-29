import { rolesForShopPermissions } from '@paserve/contracts';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  isValidOrderNumber,
  type VerifyOrderQrResponse,
} from '@paserve/contracts';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';
import { OrderTokenService } from './order-token.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { readPriceSnapshot } from './order-price-snapshots.js';
import { readReceiptShopDetails } from './receipt-shop-details.js';
import { createHash } from 'node:crypto';

export const ORDER_QR_ROLES = rolesForShopPermissions(
  'shop.orders.qr.scan',
  'shop.orders.read',
);

@Injectable()
export class OrderQrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: OrderTokenService,
  ) {}

  async scan(
    userId: string,
    shopId: string,
    token: string,
  ): Promise<VerifyOrderQrResponse> {
    const { orderId } = this.tokens.resolveReference(token, shopId);
    return this.verify(userId, shopId, orderId, token);
  }

  async verify(
    userId: string,
    shopId: string,
    orderId: string,
    token: string,
    database: Pick<Prisma.TransactionClient, 'order'> = this.prisma,
    roles = ORDER_QR_ROLES,
  ): Promise<VerifyOrderQrResponse> {
    return this.load(
      userId,
      shopId,
      orderId,
      { qrToken: token },
      database,
      roles,
    );
  }

  async lookupNumber(
    userId: string,
    shopId: string,
    orderNumber: string,
  ): Promise<VerifyOrderQrResponse> {
    this.number(orderNumber);
    const order = await this.prisma.order.findFirst({
      where: {
        orderNumber,
        shopId,
        shop: shopAccessWhere(userId, shopId, ORDER_QR_ROLES),
      },
      select: { id: true },
    });
    if (!order)
      throw new NotFoundException({
        code: 'ORDER_NOT_ACCESSIBLE',
        message:
          'No pending order with this number is available in the active shop.',
      });
    return this.reviewNumber(userId, shopId, order.id, orderNumber);
  }

  async reviewNumber(
    userId: string,
    shopId: string,
    orderId: string,
    orderNumber: string,
    database: Pick<Prisma.TransactionClient, 'order'> = this.prisma,
    roles = ORDER_QR_ROLES,
  ): Promise<VerifyOrderQrResponse> {
    this.number(orderNumber);
    return this.load(userId, shopId, orderId, { orderNumber }, database, roles);
  }

  async reviewPayment(
    userId: string,
    shopId: string,
    orderId: string,
    orderNumber: string,
    database: Pick<Prisma.TransactionClient, 'order'>,
    roles: typeof ORDER_QR_ROLES,
  ): Promise<VerifyOrderQrResponse> {
    this.number(orderNumber);
    return this.load(
      userId,
      shopId,
      orderId,
      { orderNumber },
      database,
      roles,
      true,
    );
  }

  private number(orderNumber: string) {
    if (!isValidOrderNumber(orderNumber))
      throw new BadRequestException({
        code: 'INVALID_ORDER_NUMBER',
        message: 'Enter a valid order number, such as ORD-000006.',
      });
  }

  private async load(
    userId: string,
    shopId: string,
    orderId: string,
    reference: { qrToken: string } | { orderNumber: string },
    database: Pick<Prisma.TransactionClient, 'order'>,
    roles: typeof ORDER_QR_ROLES,
    forPayment = false,
  ): Promise<VerifyOrderQrResponse> {
    if (!isUUID(orderId))
      throw new BadRequestException({
        code: 'INVALID_ORDER_ID',
        message: 'A valid order ID is required.',
      });
    // Repeat live authorization in the read; the guard can race a role change.
    const order = await database.order.findFirst({
      where: {
        id: orderId,
        ...('orderNumber' in reference
          ? { orderNumber: reference.orderNumber }
          : {}),
        shopId,
        shop: shopAccessWhere(userId, shopId, roles),
      },
      select: {
        id: true,
        shopId: true,
        orderNumber: true,
        mode: true,
        serviceType: true,
        status: true,
        paymentStatus: true,
        currency: true,
        totalPrice: true,
        tableNumber: true,
        shopDetailsSnapshot: true,
        qrTokenNonce: 'qrToken' in reference,
        qrTokenExpiresAt: 'qrToken' in reference,
        qrTokenRevokedAt: 'qrToken' in reference,
        orderItems: {
          where: {
            shopId,
            orderId,
            order: {
              shopId,
              status: forPayment ? 'CONFIRMED' : 'PENDING_CONFIRMATION',
              shop: shopAccessWhere(userId, shopId, roles),
            },
          },
          orderBy: { lineNumber: 'asc' },
          select: {
            lineNumber: true,
            productSnapshotId: true,
            productNameSnapshot: true,
            currency: true,
            quantity: true,
            notes: true,
            basePriceSnapshot: true,
            unitPriceSnapshot: true,
            lineTotalSnapshot: true,
            variantsSnapshot: true,
            addOnsSnapshot: true,
          },
        },
      },
    });
    if (!order)
      throw new NotFoundException({
        code: 'ORDER_NOT_ACCESSIBLE',
        message: 'This order is unavailable in this shop.',
      });
    if ('qrToken' in reference) this.tokens.verify(reference.qrToken, order);
    // Invalid credentials must not reveal that the order has been processed.
    if (
      order.status !== (forPayment ? 'CONFIRMED' : 'PENDING_CONFIRMATION') ||
      !(forPayment ? ['UNPAID', 'PAID'] : ['UNPAID']).includes(
        order.paymentStatus,
      )
    )
      throw new ConflictException({
        code: forPayment
          ? 'ORDER_NOT_CONFIRMED'
          : 'ORDER_NOT_PENDING_CONFIRMATION',
        message: forPayment
          ? 'Confirm the order before collecting payment. Rejected orders cannot be paid.'
          : 'This order is no longer awaiting cashier confirmation. Check its current status with the shop.',
      });
    // Load only saved snapshots. Deleted/edited menu entries cannot reprice an
    // existing order. Fail closed rather than displaying an incomplete receipt.
    let items: VerifyOrderQrResponse['order']['items'];
    try {
      if (
        !order.orderItems.length ||
        order.orderItems.length > 100 ||
        order.orderItems.some((item, index) => item.lineNumber !== index + 1)
      )
        throw new Error('Invalid receipt lines');
      items = order.orderItems.map(readPriceSnapshot);
      if (
        !items
          .reduce(
            (sum, item) => sum.plus(item.totalPrice),
            new Prisma.Decimal(0),
          )
          .equals(order.totalPrice)
      )
        throw new Error('Invalid receipt total');
    } catch {
      throw new ConflictException({
        code: 'ORDER_DETAILS_UNAVAILABLE',
        message:
          "This order's saved details could not be loaded. Ask the shop owner for help.",
      });
    }
    // Return saved cashier details without exposing the bearer credential.
    const review = {
      id: order.id,
      shopId: order.shopId,
      orderNumber: order.orderNumber,
      mode: order.mode,
      serviceType: order.serviceType,
      status: order.status,
      paymentStatus: order.paymentStatus,
      currency: order.currency,
      totalPrice: order.totalPrice.toFixed(2),
      tableNumber: order.tableNumber,
      items,
    };
    return {
      verified: true as const,
      order: {
        ...review,
        shopDetails: readReceiptShopDetails(order.shopDetailsSnapshot),
        reviewVersion: createHash('sha256')
          .update(JSON.stringify(review))
          .digest('hex'),
      },
    };
  }
}
