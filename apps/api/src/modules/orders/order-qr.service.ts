import {
  BadRequestException,
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

export const ORDER_QR_ROLES = SHOP_ROLES.filter((role) =>
  hasShopPermission(role, 'shop.orders.qr.scan'),
);

@Injectable()
export class OrderQrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: OrderTokenService,
  ) {}

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
      },
    });
    if (!order)
      throw new NotFoundException({
        code: 'ORDER_NOT_ACCESSIBLE',
        message: 'This order is unavailable in this shop.',
      });
    this.tokens.verify(token, order);
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
      },
    };
  }
}
