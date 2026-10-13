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
  PAYMENT_REFERENCE_PATTERN,
  isSafeOtherPaymentText,
  type CashPaymentReviewResponse,
} from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { shopAccessWhere } from '../tenancy/shop-scope.js';
import { OrderQrService } from './order-qr.service.js';
import type { CashPaymentDto } from './cash-payment.dto.js';
import type { ManualGcashPaymentDto } from './manual-gcash-payment.dto.js';
import type { ManualCardPaymentDto } from './manual-card-payment.dto.js';
import type { OtherPaymentDto } from './other-payment.dto.js';
import type { CreatePaymentDto } from './create-payment.dto.js';

export const CASH_PAYMENT_ROLES = SHOP_ROLES.filter(
  (role) =>
    hasShopPermission(role, 'shop.payments.record') &&
    hasShopPermission(role, 'shop.orders.read'),
);
export const CREATE_PAYMENT_ROLES = CASH_PAYMENT_ROLES.filter((role) =>
  hasShopPermission(role, 'shop.orders.confirm'),
);
const conflict = (
  code = 'CASH_PAYMENT_CONFLICT',
  message = 'The payment state changed. Refresh the order before recording payment.',
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
        paymentReference: true,
        paymentDescription: true,
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
        !['CASH', 'GCASH_MANUAL', 'CARD_MANUAL', 'OTHER'].includes(
          saved.paymentMethod ?? '',
        ) ||
        !saved.paymentRequestId ||
        !saved.paidAt ||
        !saved.paidBy ||
        !saved.amountReceived ||
        !saved.changeDue ||
        !saved.amountReceived.minus(saved.changeDue).equals(order.totalPrice) ||
        (saved.paymentMethod !== 'CASH' && !saved.changeDue.isZero()) ||
        (saved.paymentMethod === 'OTHER' &&
          (!saved.paymentDescription?.trim() ||
            !isSafeOtherPaymentText(saved.paymentDescription, 80) ||
            (saved.paymentReference != null &&
              !isSafeOtherPaymentText(saved.paymentReference))))
      )
        throw conflict(
          'CASH_PAYMENT_DETAILS_UNAVAILABLE',
          'The saved payment receipt could not be loaded. Ask the shop owner for help.',
        );
      payment = {
        method: saved.paymentMethod as
          'CASH' | 'GCASH_MANUAL' | 'CARD_MANUAL' | 'OTHER',
        requestId: saved.paymentRequestId,
        amountReceived: saved.amountReceived.toFixed(2),
        changeDue: saved.changeDue.toFixed(2),
        paidAt: saved.paidAt.toISOString(),
        paidBy: saved.paidBy,
        reference: saved.paymentReference ?? null,
        description: saved.paymentDescription ?? null,
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
    return this.settle(actorId, shopId, orderId, dto, 'CASH');
  }

  async recordGcash(
    actorId: string,
    shopId: string,
    orderId: string,
    dto: ManualGcashPaymentDto,
  ): Promise<CashPaymentReviewResponse> {
    return this.settle(actorId, shopId, orderId, dto, 'GCASH_MANUAL');
  }

  async recordCard(
    actorId: string,
    shopId: string,
    orderId: string,
    dto: ManualCardPaymentDto,
  ): Promise<CashPaymentReviewResponse> {
    return this.settle(actorId, shopId, orderId, dto, 'CARD_MANUAL');
  }

  async recordOther(
    actorId: string,
    shopId: string,
    orderId: string,
    dto: OtherPaymentDto,
  ): Promise<CashPaymentReviewResponse> {
    return this.settle(actorId, shopId, orderId, dto, 'OTHER');
  }

  async create(
    actorId: string,
    shopId: string,
    orderId: string,
    dto: CreatePaymentDto,
  ): Promise<CashPaymentReviewResponse> {
    if (
      !['CASH', 'GCASH_MANUAL', 'CARD_MANUAL', 'OTHER'].includes(dto.method) ||
      (dto.qrToken === undefined) === (dto.orderNumber === undefined) ||
      (dto.orderNumber !== undefined && !isValidOrderNumber(dto.orderNumber)) ||
      (dto.qrToken !== undefined &&
        (typeof dto.qrToken !== 'string' ||
          !dto.qrToken ||
          dto.qrToken.length > 1024)) ||
      (dto.method === 'CASH'
        ? dto.receivedConfirmed !== undefined ||
          dto.reference !== undefined ||
          dto.description !== undefined
        : dto.amountReceived !== undefined) ||
      (dto.method !== 'OTHER' && dto.description !== undefined)
    )
      throw new BadRequestException({
        code: 'INVALID_CREATE_PAYMENT',
        message: 'Choose one order reference and a valid payment method.',
      });
    const payment =
      dto.method === 'CASH'
        ? {
            requestId: dto.requestId,
            reviewVersion: dto.reviewVersion,
            amountReceived: dto.amountReceived!,
          }
        : {
            requestId: dto.requestId,
            reviewVersion: dto.reviewVersion,
            receivedConfirmed: dto.receivedConfirmed!,
            ...(dto.reference !== undefined
              ? { reference: dto.reference }
              : {}),
            ...(dto.method === 'OTHER'
              ? { description: dto.description! }
              : {}),
          };
    return this.settle(actorId, shopId, orderId, payment, dto.method, dto);
  }

  private async settle(
    actorId: string,
    shopId: string,
    orderId: string,
    dto: CashPaymentDto | ManualGcashPaymentDto | OtherPaymentDto,
    method: 'CASH' | 'GCASH_MANUAL' | 'CARD_MANUAL' | 'OTHER',
    confirmation?: CreatePaymentDto,
  ): Promise<CashPaymentReviewResponse> {
    const cashAmount = 'amountReceived' in dto ? dto.amountReceived : null;
    const rawReference = 'reference' in dto ? dto.reference : null;
    const rawDescription = 'description' in dto ? dto.description : null;
    if (
      method === 'OTHER' &&
      (!isSafeOtherPaymentText(rawDescription, 80) ||
        !rawDescription.trim() ||
        (rawReference != null && !isSafeOtherPaymentText(rawReference)))
    )
      throw new BadRequestException({
        code: 'INVALID_OTHER_PAYMENT_DETAILS',
        message:
          'Describe the payment method in up to 80 plain-text characters. Use a receipt reference, not card details.',
      });
    const description = method === 'OTHER' ? rawDescription!.trim() : null;
    if (
      rawReference != null &&
      (typeof rawReference !== 'string' ||
        !PAYMENT_REFERENCE_PATTERN.test(rawReference))
    )
      throw new BadRequestException({
        code: 'INVALID_PAYMENT_REFERENCE',
        message: 'Enter a plain-text reference of up to 200 characters.',
      });
    const reference = method !== 'CASH' ? rawReference?.trim() || null : null;
    if (
      !isUUID(orderId) ||
      !isUUID(dto.requestId) ||
      (method === 'CASH'
        ? cashAmountCents(cashAmount) === null
        : !('receivedConfirmed' in dto) || dto.receivedConfirmed !== true) ||
      !/^[a-f0-9]{64}$(?![\s\S])/.test(dto.reviewVersion)
    )
      throw new BadRequestException({
        code:
          method === 'CASH'
            ? 'INVALID_CASH_PAYMENT'
            : method === 'OTHER'
              ? 'INVALID_OTHER_PAYMENT'
              : method === 'CARD_MANUAL'
                ? 'INVALID_CARD_PAYMENT'
                : 'INVALID_GCASH_PAYMENT',
        message:
          'A valid reviewed order and payment confirmation are required.',
      });
    const roles = confirmation ? CREATE_PAYMENT_ROLES : CASH_PAYMENT_ROLES;
    const access = shopAccessWhere(actorId, shopId, roles);
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
              status: true,
            },
          });
          if (!current) throw this.unavailable();
          await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} AND "shopId" = ${shopId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM order_items WHERE "orderId" = ${orderId} AND "shopId" = ${shopId} ORDER BY "lineNumber" FOR UPDATE`;
          const confirming =
            confirmation && current.status === 'PENDING_CONFIRMATION';
          const review = confirming
            ? {
                ...(confirmation.qrToken !== undefined
                  ? await this.qr.verify(
                      actorId,
                      shopId,
                      orderId,
                      confirmation.qrToken,
                      tx,
                      roles,
                    )
                  : await this.qr.reviewNumber(
                      actorId,
                      shopId,
                      orderId,
                      confirmation.orderNumber!,
                      tx,
                      roles,
                    )),
                payment: null,
              }
            : await this.review(actorId, shopId, orderId, tx);
          if (
            confirmation?.orderNumber !== undefined &&
            confirmation.orderNumber !== review.order.orderNumber
          )
            throw this.unavailable();
          if (review.payment) {
            if (
              review.payment.requestId === dto.requestId &&
              review.payment.method === method &&
              (review.payment.reference ?? null) === reference &&
              (review.payment.description ?? null) === description &&
              (method !== 'CASH' ||
                review.payment.amountReceived === cashAmount) &&
              review.payment.paidBy === actorId &&
              current.paymentReviewVersion === dto.reviewVersion
            )
              return review;
            throw conflict(
              'ORDER_ALREADY_PAID',
              'This order is already paid. Do not collect or record another payment.',
            );
          }
          if (review.order.reviewVersion !== dto.reviewVersion)
            throw conflict(
              'ORDER_REVIEW_CHANGED',
              'This order changed. Refresh and review the saved total before recording payment.',
            );
          const total = new Prisma.Decimal(review.order.totalPrice);
          const amount =
            method === 'CASH' ? new Prisma.Decimal(cashAmount!) : total;
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
              status: confirming ? 'PENDING_CONFIRMATION' : 'CONFIRMED',
              paymentStatus: 'UNPAID',
              totalPrice: total,
              ...(confirming && confirmation.qrToken !== undefined
                ? { qrTokenRevokedAt: null, qrTokenExpiresAt: { gt: now } }
                : {}),
            },
            data: {
              ...(confirming
                ? {
                    status: 'CONFIRMED',
                    decidedAt: now,
                    decidedBy: actorId,
                    rejectionReason: null,
                    qrTokenRevokedAt: now,
                  }
                : {}),
              paymentStatus: 'PAID',
              paymentMethod: method,
              paymentReference: reference,
              paymentDescription: description,
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
