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
      select: { id: true },
    });
    if (!shop)
      throw new NotFoundException({
        code: 'ORDER_NOT_ACCESSIBLE',
        message: 'This order is unavailable.',
      });
    const reference = this.tokens.resolveReference(credential, shop.id);
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
        queuedAt: true,
      },
    });
    if (!order)
      throw new NotFoundException({
        code: 'ORDER_NOT_ACCESSIBLE',
        message: 'This order is unavailable.',
      });
    // Verify canonical signature, nonce, shop/order binding, expiry, and receipt
    // revocation. Staff scan consumption never grants write authority here.
    this.tokens.verifyReceipt(credential, order);
    const preparationStatus = order.preparationStatus ?? null;
    const startedAt = order.preparationStartedAt ?? null;
    if (
      !['PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED'].includes(
        order.status,
      ) ||
      !['UNPAID', 'PAID'].includes(order.paymentStatus) ||
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
        (!startedAt || !order.queuedAt || startedAt < order.queuedAt))
    )
      throw new BadRequestException({
        code: 'INVALID_ORDER_STATE',
        message: 'Unable to read the saved order status.',
      });
    return {
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
      },
    };
  }
}
