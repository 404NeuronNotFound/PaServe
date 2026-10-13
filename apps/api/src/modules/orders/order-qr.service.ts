import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  hasShopPermission,
  SHOP_ROLES,
  type VerifyOrderQrResponse,
} from '@paserve/contracts';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';
import { OrderTokenService } from './order-token.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { readPriceSnapshot } from './order-price-snapshots.js';

export const ORDER_QR_ROLES = SHOP_ROLES.filter(
  (role) =>
    hasShopPermission(role, 'shop.orders.qr.scan') &&
    hasShopPermission(role, 'shop.orders.read'),
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
  ): Promise<VerifyOrderQrResponse> {
    if (!isUUID(orderId))
      throw new BadRequestException({
        code: 'INVALID_ORDER_ID',
        message: 'A valid order ID is required.',
      });
    // Repeat live authorization in the read; the guard can race a role change.
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        shopId,
        shop: shopAccessWhere(userId, shopId, ORDER_QR_ROLES),
      },
      select: {
        id: true,
        shopId: true,
        orderNumber: true,
        mode: true,
        status: true,
        paymentStatus: true,
        currency: true,
        totalPrice: true,
        tableNumber: true,
        qrTokenNonce: true,
        qrTokenExpiresAt: true,
        qrTokenRevokedAt: true,
        orderItems: {
          where: {
            shopId,
            orderId,
            order: {
              shopId,
              status: 'PENDING_CONFIRMATION',
              shop: shopAccessWhere(userId, shopId, ORDER_QR_ROLES),
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
    this.tokens.verify(token, order);
    // Invalid credentials must not reveal that the order has been processed.
    if (order.status !== 'PENDING_CONFIRMATION')
      throw new ConflictException({
        code: 'ORDER_NOT_PENDING_CONFIRMATION',
        message:
          'This order is no longer awaiting cashier confirmation. Check its current status with the shop.',
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
    return {
      verified: true as const,
      order: {
        id: order.id,
        shopId: order.shopId,
        orderNumber: order.orderNumber,
        mode: order.mode,
        status: order.status,
        paymentStatus: order.paymentStatus,
        currency: order.currency,
        totalPrice: order.totalPrice.toFixed(2),
        tableNumber: order.tableNumber,
        items,
      },
    };
  }
}
