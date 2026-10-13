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
  cashAmountCents,
  isValidOrderNumber,
  type CashPaymentReviewResponse,
} from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';
import { OrderQrService } from './order-qr.service.js';
import type { CashPaymentDto } from './cash-payment.dto.js';

export const CASH_PAYMENT_ROLES = SHOP_ROLES.filter(
  (role) =>
    hasShopPermission(role, 'shop.payments.record') &&
    hasShopPermission(role, 'shop.orders.read'),
);
const conflict = (
  code = 'CASH_PAYMENT_CONFLICT',
  message = 'The payment state changed. Refresh the order before collecting cash.',
) => new ConflictException({ code, message });

@Injectable()
export class CashPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: OrderQrService,
  ) {}

  async lookup(actorId: string, shopId: string, orderNumber: string) {
    if (!isValidOrderNumber(orderNumber))
      throw new BadRequestException({
        code: 'INVALID_ORDER_NUMBER',
        message: 'Enter a valid order number.',
      });
    const saved = await this.prisma.order.findFirst({
      where: {
        shopId,
        orderNumber,
        shop: shopAccessWhere(actorId, shopId, CASH_PAYMENT_ROLES),
      },
      select: { id: true },
    });
    if (!saved) throw this.unavailable();
    return this.review(actorId, shopId, saved.id);
  }

  async review(
    actorId: string,
    shopId: string,
    orderId: string,
    database: Pick<Prisma.TransactionClient, 'order'> = this.prisma,
  ): Promise<CashPaymentReviewResponse> {
    if (!isUUID(orderId))
      throw new BadRequestException({
        code: 'INVALID_ORDER_ID',
        message: 'A valid order ID is required.',
      });
    const saved = await database.order.findFirst({
      where: {
        id: orderId,
        shopId,
        shop: shopAccessWhere(actorId, shopId, CASH_PAYMENT_ROLES),
      },
      select: {
        id: true,
        orderNumber: true,
        paymentStatus: true,
        paymentMethod: true,
        paymentRequestId: true,
        paymentReviewVersion: true,
        amountReceived: true,
        changeDue: true,
        paidAt: true,
        paidBy: true,
      },
    });
    if (!saved) throw this.unavailable();
    const { order } = await this.qr.reviewPayment(
      actorId,
      shopId,
      orderId,
      saved.orderNumber,
      database,
      CASH_PAYMENT_ROLES,
    );
    // Repeated reads can race payment collection. Never return a mixed paid/unpaid review.
    if (order.paymentStatus !== saved.paymentStatus) throw conflict();
    let payment: CashPaymentReviewResponse['payment'] = null;
    if (saved.paymentStatus === 'PAID') {
      if (
        saved.paymentMethod !== 'CASH' ||
        !saved.paymentRequestId ||
        !saved.paidAt ||
        !saved.paidBy ||
        !saved.amountReceived ||
        !saved.changeDue ||
        !saved.amountReceived.minus(saved.changeDue).equals(order.totalPrice)
      )
        throw conflict(
          'CASH_PAYMENT_DETAILS_UNAVAILABLE',
          'The saved cash receipt could not be loaded. Ask the shop owner for help.',
        );
      payment = {
        method: 'CASH',
        requestId: saved.paymentRequestId,
        amountReceived: saved.amountReceived.toFixed(2),
        changeDue: saved.changeDue.toFixed(2),
        paidAt: saved.paidAt.toISOString(),
        paidBy: saved.paidBy,
      };
    }
    return { order, payment };
  }

  async collect(
    actorId: string,
    shopId: string,
    orderId: string,
    dto: CashPaymentDto,
  ): Promise<CashPaymentReviewResponse> {
    if (
      !isUUID(orderId) ||
      !isUUID(dto.requestId) ||
      cashAmountCents(dto.amountReceived) === null ||
      !/^[a-f0-9]{64}$(?![\s\S])/.test(dto.reviewVersion)
    )
      throw new BadRequestException({
        code: 'INVALID_CASH_PAYMENT',
        message: 'A valid cash amount and reviewed order are required.',
      });
    const access = shopAccessWhere(actorId, shopId, CASH_PAYMENT_ROLES);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE`;
          await tx.$queryRaw`SELECT m.id FROM shop_members m JOIN users u ON u.id = m."userId" WHERE m."shopId" = ${shopId} AND m."userId" = ${actorId} FOR UPDATE OF m, u`;
          const current = await tx.order.findFirst({
            where: { id: orderId, shopId, shop: access },
            select: {
              id: true,
              paymentRequestId: true,
              paymentReviewVersion: true,
            },
          });
          if (!current) throw this.unavailable();
          await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} AND "shopId" = ${shopId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM order_items WHERE "orderId" = ${orderId} AND "shopId" = ${shopId} ORDER BY "lineNumber" FOR UPDATE`;
          const review = await this.review(actorId, shopId, orderId, tx);
          if (review.payment) {
            if (
              review.payment.requestId === dto.requestId &&
              review.payment.amountReceived === dto.amountReceived &&
              review.payment.paidBy === actorId &&
              current.paymentReviewVersion === dto.reviewVersion
            )
              return review;
            throw conflict(
              'ORDER_ALREADY_PAID',
              'This order is already paid. Do not collect cash again.',
            );
          }
          if (review.order.reviewVersion !== dto.reviewVersion)
            throw conflict(
              'ORDER_REVIEW_CHANGED',
              'This order changed. Refresh and review the saved total before collecting cash.',
            );
          const amount = new Prisma.Decimal(dto.amountReceived);
          const total = new Prisma.Decimal(review.order.totalPrice);
          if (amount.lessThan(total))
            throw new BadRequestException({
              code: 'CASH_AMOUNT_INSUFFICIENT',
              message: 'The amount received must cover the order total.',
            });
          const now = new Date();
          const changed = await tx.order.updateMany({
            where: {
              id: orderId,
              shopId,
              shop: access,
              status: 'CONFIRMED',
              paymentStatus: 'UNPAID',
              totalPrice: total,
            },
            data: {
              paymentStatus: 'PAID',
              paymentMethod: 'CASH',
              paymentRequestId: dto.requestId,
              paymentReviewVersion: dto.reviewVersion,
              amountReceived: amount,
              changeDue: amount.minus(total),
              paidAt: now,
              paidBy: actorId,
            },
          });
          if (changed.count !== 1) throw conflict();
          return this.review(actorId, shopId, orderId, tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002'].includes(error.code)
      )
        throw conflict();
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2010'
      ) {
        const cause = (
          error.meta?.driverAdapterError as
            { cause?: { originalCode?: string } } | undefined
        )?.cause;
        if (
          [error.meta?.code, cause?.originalCode].some((code) =>
            ['40001', '40P01'].includes(String(code)),
          )
        )
          throw conflict();
      }
      throw error;
    }
  }

  private unavailable() {
    return new NotFoundException({
      code: 'ORDER_NOT_ACCESSIBLE',
      message: 'This order is unavailable in this shop.',
    });
  }
}
