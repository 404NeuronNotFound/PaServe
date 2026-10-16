import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { CustomerOrderStatusResponse } from '@paserve/contracts';
import { PREPARATION_STATUSES } from '@paserve/contracts';
import { PrismaService } from '../../database/prisma.service.js';
import { OrderTokenService } from './order-token.service.js';

@Injectable()
export class CustomerOrderStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: OrderTokenService,
  ) {}

  async read(
    slug: string,
    orderId: string,
    credential: string,
  ): Promise<CustomerOrderStatusResponse> {
    if (!isUUID(orderId))
      throw new BadRequestException({
        code: 'INVALID_ORDER_ID',
        message: 'A valid order reference is required.',
      });
    const shop = await this.prisma.shop.findFirst({
      where: { slug, isActive: true },
      select: { id: true, name: true, primaryColor: true, accentColor: true },
    });
    if (!shop)
      throw new NotFoundException({
        code: 'ORDER_NOT_ACCESSIBLE',
        message: 'This order is unavailable.',
      });
    const reference = this.tokens.resolveTrackingReference(credential, shop.id);
    if (reference.orderId !== orderId)
      throw new NotFoundException({
        code: 'ORDER_NOT_ACCESSIBLE',
        message: 'This order is unavailable.',
      });
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        shopId: shop.id,
        shop: { id: shop.id, isActive: true },
      },
      select: {
        id: true,
        shopId: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        decidedAt: true,
        updatedAt: true,
        qrTokenNonce: true,
        qrTokenExpiresAt: true,
        qrTokenRevokedAt: true,
        receiptAccessRevokedAt: true,
        preparationStatus: true,
        preparationStartedAt: true,
        preparationReadyAt: true,
        completedAt: true,
        queuedAt: true,
        mode: true,
        tableCode: true,
        tableNumber: true,
        totalPrice: true,
      },
    });
    if (!order)
      throw new NotFoundException({
        code: 'ORDER_NOT_ACCESSIBLE',
        message: 'This order is unavailable.',
      });
    // Verify canonical signature, nonce, shop/order binding, expiry, and receipt
    // revocation. Staff scan consumption never grants write authority here.
    this.tokens.verifyTracking(credential, order);
    const preparationStatus = order.preparationStatus ?? null;
    const startedAt = order.preparationStartedAt ?? null;
    const readyAt = order.preparationReadyAt ?? null;
    const completedAt = order.completedAt ?? null;
    if (
      !['PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED'].includes(
        order.status,
      ) ||
      !['UNPAID', 'PAID'].includes(order.paymentStatus) ||
      (order.status !== 'CONFIRMED' && order.paymentStatus !== 'UNPAID') ||
      (order.status === 'CONFIRMED' &&
        (order.paymentStatus !== 'PAID' || !order.decidedAt)) ||
      (preparationStatus !== null &&
        (!PREPARATION_STATUSES.includes(
          preparationStatus as (typeof PREPARATION_STATUSES)[number],
        ) ||
          order.status !== 'CONFIRMED' ||
          order.paymentStatus !== 'PAID')) ||
      (preparationStatus !== null &&
        preparationStatus !== 'QUEUED' &&
        (!startedAt || !order.queuedAt || startedAt < order.queuedAt)) ||
      ((preparationStatus === 'READY' || preparationStatus === 'COMPLETED') &&
        (!readyAt || !startedAt || readyAt < startedAt)) ||
      (preparationStatus === 'COMPLETED' &&
        (!completedAt || !readyAt || completedAt < readyAt))
    )
      throw new BadRequestException({
        code: 'INVALID_ORDER_STATE',
        message: 'Unable to read the saved order status.',
      });
    return {
      trackingExpiresAt: order.qrTokenExpiresAt.toISOString(),
      receipt: {
        shopSlug: slug,
        shopName: shop.name,
        primaryColor: shop.primaryColor,
        accentColor: shop.accentColor,
        id: order.id,
        orderNumber: order.orderNumber,
        mode: order.mode as 'DINE_IN' | 'TAKEOUT',
        table:
          order.mode === 'DINE_IN'
            ? { code: order.tableCode!, number: order.tableNumber! }
            : null,
        status: 'PENDING_CONFIRMATION',
        currency: 'PHP',
        totalPrice: order.totalPrice.toFixed(2),
      },
      order: {
        id: order.id,
        shopId: order.shopId,
        orderNumber: order.orderNumber,
        status: order.status as CustomerOrderStatusResponse['order']['status'],
        paymentStatus:
          order.paymentStatus as CustomerOrderStatusResponse['order']['paymentStatus'],
        confirmedAt:
          order.status === 'CONFIRMED' ? order.decidedAt!.toISOString() : null,
        updatedAt: order.updatedAt.toISOString(),
        preparationStatus:
          preparationStatus as CustomerOrderStatusResponse['order']['preparationStatus'],
        preparationStartedAt: startedAt?.toISOString() ?? null,
        preparationReadyAt: readyAt?.toISOString() ?? null,
        completedAt: completedAt?.toISOString() ?? null,
      },
    };
  }
}
