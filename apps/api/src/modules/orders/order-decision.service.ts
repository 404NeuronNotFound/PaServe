import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  SHOP_ROLES,
  hasShopPermission,
  isValidOrderNumber,
  type OrderDecisionResponse,
} from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';
import { OrderQrService } from './order-qr.service.js';
import type { OrderDecisionDto, RejectOrderDto } from './order-decision.dto.js';
import type {
  OrderNumberDecisionDto,
  RejectOrderNumberDto,
} from './order-number-lookup.dto.js';

export const ORDER_CONFIRM_ROLES = SHOP_ROLES.filter(
  (role) =>
    hasShopPermission(role, 'shop.orders.confirm') &&
    hasShopPermission(role, 'shop.orders.read'),
);
export const ORDER_REJECT_ROLES = SHOP_ROLES.filter(
  (role) =>
    hasShopPermission(role, 'shop.orders.reject') &&
    hasShopPermission(role, 'shop.orders.read'),
);
const changed = () =>
  new ConflictException({
    code: 'ORDER_REVIEW_CHANGED',
    message:
      'This order changed or was already processed. Refresh the order before taking any action.',
  });

@Injectable()
export class OrderDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: OrderQrService,
  ) {}

  async decide(
    actorId: string,
    shopId: string,
    orderId: string,
    action: 'CONFIRMED' | 'REJECTED',
    dto:
      | OrderDecisionDto
      | RejectOrderDto
      | OrderNumberDecisionDto
      | RejectOrderNumberDto,
  ): Promise<OrderDecisionResponse> {
    const byNumber = 'orderNumber' in dto;
    if (
      !isUUID(orderId) ||
      !['CONFIRMED', 'REJECTED'].includes(action) ||
      (byNumber && ('qrToken' in dto || !isValidOrderNumber(dto.orderNumber)))
    )
      throw new BadRequestException({
        code: 'INVALID_ORDER_DECISION',
        message: 'A valid order and decision are required.',
      });
    const roles =
      action === 'CONFIRMED' ? ORDER_CONFIRM_ROLES : ORDER_REJECT_ROLES;
    const access = shopAccessWhere(actorId, shopId, roles);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Staff writers lock the shop first too. Hold shop, membership and actor
          // through commit, then repeat current permission checks on read/write.
          await tx.$queryRaw`SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE`;
          await tx.$queryRaw`SELECT m.id FROM shop_members m JOIN users u ON u.id = m."userId"
          WHERE m."shopId" = ${shopId} AND m."userId" = ${actorId} FOR UPDATE OF m, u`;
          const current = await tx.order.findFirst({
            where: {
              id: orderId,
              shopId,
              shop: access,
              ...(byNumber ? { orderNumber: dto.orderNumber } : {}),
            },
            select: { id: true },
          });
          if (!current)
            throw new NotFoundException({
              code: 'ORDER_NOT_ACCESSIBLE',
              message: 'This order is unavailable in this shop.',
            });
          await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} AND "shopId" = ${shopId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM order_items WHERE "orderId" = ${orderId} AND "shopId" = ${shopId} ORDER BY "lineNumber" FOR UPDATE`;
          const { order } = byNumber
            ? await this.qr.reviewNumber(
                actorId,
                shopId,
                orderId,
                dto.orderNumber,
                tx,
                roles,
              )
            : await this.qr.verify(
                actorId,
                shopId,
                orderId,
                dto.qrToken,
                tx,
                roles,
              );
          if (
            order.reviewVersion !== dto.reviewVersion ||
            order.paymentStatus !== 'UNPAID'
          )
            throw changed();
          const now = new Date();
          if (action === 'CONFIRMED')
            throw new ConflictException({
              code: 'PAYMENT_REQUIRED',
              message:
                'Confirm and pay together. Choose a payment method before confirming this order.',
            });
          const rejectionReason =
            action === 'REJECTED'
              ? (dto as RejectOrderDto).rejectionReason?.trim() || null
              : null;
          const saved = await tx.order.updateMany({
            where: {
              id: orderId,
              shopId,
              shop: access,
              status: 'PENDING_CONFIRMATION',
              paymentStatus: 'UNPAID',
              ...(byNumber
                ? { orderNumber: dto.orderNumber }
                : { qrTokenRevokedAt: null, qrTokenExpiresAt: { gt: now } }),
            },
            data: {
              status: action,
              decidedAt: now,
              decidedBy: actorId,
              rejectionReason,
              qrTokenRevokedAt: now,
            },
          });
          if (saved.count !== 1) throw changed();
          return {
            order: {
              id: orderId,
              shopId,
              orderNumber: order.orderNumber,
              status: action,
              paymentStatus: 'UNPAID' as const,
              decidedAt: now.toISOString(),
              decidedBy: actorId,
              rejectionReason,
            },
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const cause = (
          error.meta?.driverAdapterError as
            { cause?: { originalCode?: string } } | undefined
        )?.cause;
        if (
          error.code === 'P2034' ||
          (error.code === 'P2010' &&
            [error.meta?.code, cause?.originalCode].some((code) =>
              ['40001', '40P01'].includes(String(code)),
            ))
        )
          throw changed();
      }
      throw error;
    }
  }
}
