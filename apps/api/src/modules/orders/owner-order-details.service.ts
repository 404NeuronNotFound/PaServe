import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  parseReceiptPaymentDetails,
  type OwnerOrderDetailsResponse,
} from '@paserve/contracts';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { shopPermissionWhere } from '../tenancy/shop-scope.js';
import { readPriceSnapshot } from './order-price-snapshots.js';
import { readReceiptShopDetails } from './receipt-shop-details.js';

@Injectable()
export class OwnerOrderDetailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: ShopMembersService,
  ) {}

  async get(
    actorId: string,
    shopId: string,
    orderId: string,
  ): Promise<OwnerOrderDetailsResponse> {
    await this.members.requireOwner(actorId, shopId);
    if (!isUUID(orderId))
      throw new BadRequestException({
        code: 'INVALID_ORDER_ID',
        message: 'A valid order ID is required.',
      });
    const access = shopPermissionWhere(
      actorId,
      shopId,
      'shop.orders.overview.read',
    );
    const saved = await this.prisma.order.findFirst({
      where: { id: orderId, shopId, shop: access },
      select: {
        id: true,
        shopId: true,
        orderNumber: true,
        mode: true,
        tableNumber: true,
        status: true,
        paymentStatus: true,
        preparationStatus: true,
        currency: true,
        totalPrice: true,
        shopDetailsSnapshot: true,
        createdAt: true,
        updatedAt: true,
        decidedAt: true,
        decidedBy: true,
        rejectionReason: true,
        paymentMethod: true,
        paymentReference: true,
        paymentDescription: true,
        amountReceived: true,
        changeDue: true,
        paidAt: true,
        paidBy: true,
        queuedAt: true,
        preparationStartedAt: true,
        preparationStartedBy: true,
        preparationReadyAt: true,
        preparationReadyBy: true,
        completedAt: true,
        completedBy: true,
        orderItems: {
          where: { shopId, orderId, order: { shopId, shop: access } },
          orderBy: { lineNumber: 'asc' },
          take: 101,
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
    if (!saved)
      throw new NotFoundException({
        code: 'ORDER_NOT_ACCESSIBLE',
        message: 'This order is unavailable in this shop.',
      });
    let items: OwnerOrderDetailsResponse['order']['items'] = null;
    let shopDetails: OwnerOrderDetailsResponse['order']['shopDetails'] = null;
    let snapshotIssue: string | null = null;
    let payment =
      saved.paymentStatus === 'PAID'
        ? parseReceiptPaymentDetails({
            method: saved.paymentMethod,
            reference: saved.paymentReference,
            description: saved.paymentDescription,
            ...(saved.amountReceived
              ? { amountReceived: saved.amountReceived.toFixed(2) }
              : {}),
            ...(saved.changeDue
              ? { changeDue: saved.changeDue.toFixed(2) }
              : {}),
          })
        : null;
    // Match the customer receipt's saved-cash settlement invariant, independently
    // of item integrity, so a broken item cannot expose a bad tender/change pair.
    const invalidCash =
      saved.paymentStatus === 'PAID' &&
      saved.paymentMethod === 'CASH' &&
      saved.amountReceived != null &&
      (!payment ||
        !saved.changeDue ||
        saved.changeDue.isNegative() ||
        !saved.amountReceived.minus(saved.changeDue).equals(saved.totalPrice));
    if (invalidCash) payment = null;
    try {
      shopDetails = readReceiptShopDetails(saved.shopDetailsSnapshot);
      if (invalidCash) throw new Error('Invalid saved cash settlement');
      if (
        !saved.orderItems.length ||
        saved.orderItems.length > 100 ||
        saved.orderItems.some((item, index) => item.lineNumber !== index + 1)
      )
        throw new Error('Invalid lines');
      const lines = saved.orderItems.map(readPriceSnapshot);
      if (
        !lines
          .reduce(
            (sum, item) => sum.plus(item.totalPrice),
            new Prisma.Decimal(0),
          )
          .equals(saved.totalPrice)
      )
        throw new Error('Invalid total');
      items = lines;
    } catch {
      snapshotIssue =
        'Saved receipt details are unavailable. Order metadata remains available for review.';
    }
    const history: OwnerOrderDetailsResponse['order']['history'] = [
      { status: 'PLACED', at: saved.createdAt.toISOString(), actorId: null },
    ];
    const add = (
      status: (typeof history)[number]['status'],
      at: Date | null,
      actor: string | null,
    ) => {
      if (at) history.push({ status, at: at.toISOString(), actorId: actor });
    };
    if (saved.status === 'CONFIRMED' || saved.status === 'REJECTED')
      add(saved.status, saved.decidedAt, saved.decidedBy);
    add('PAID', saved.paidAt, saved.paidBy);
    add('QUEUED', saved.queuedAt, null);
    add('PREPARING', saved.preparationStartedAt, saved.preparationStartedBy);
    add('READY', saved.preparationReadyAt, saved.preparationReadyBy);
    add('COMPLETED', saved.completedAt, saved.completedBy);
    history.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    // Older writes mixed Prisma's application-clock @updatedAt with database
    // milestone time. Project the latest persisted change, without changing
    // recorded milestones or requiring a data rewrite for existing orders.
    const updatedAt = new Date(
      Math.max(
        saved.updatedAt.getTime(),
        ...history.map((event) => Date.parse(event.at)),
      ),
    );
    const permittedActions: OwnerOrderDetailsResponse['order']['permittedActions'] =
      [];
    if (items && !snapshotIssue) {
      if (
        (saved.status === 'PENDING_CONFIRMATION' ||
          saved.status === 'CONFIRMED') &&
        saved.paymentStatus === 'UNPAID' &&
        saved.preparationStatus === null
      )
        permittedActions.push('CASHIER');
      if (saved.status === 'CONFIRMED' && saved.paymentStatus === 'PAID') {
        permittedActions.push('RECEIPT');
        if (saved.preparationStatus === 'QUEUED')
          permittedActions.push('START_PREPARING');
        if (saved.preparationStatus === 'PREPARING')
          permittedActions.push('MARK_READY');
        if (saved.preparationStatus === 'READY')
          permittedActions.push('COMPLETE');
      }
    }
    return {
      order: {
        id: saved.id,
        shopId: saved.shopId,
        orderNumber: saved.orderNumber,
        mode: saved.mode,
        tableNumber: saved.tableNumber,
        status: saved.status as OwnerOrderDetailsResponse['order']['status'],
        paymentStatus:
          saved.paymentStatus as OwnerOrderDetailsResponse['order']['paymentStatus'],
        preparationStatus:
          saved.preparationStatus as OwnerOrderDetailsResponse['order']['preparationStatus'],
        currency: 'PHP',
        totalPrice: saved.totalPrice.toFixed(2),
        shopDetails,
        items,
        snapshotIssue,
        payment,
        rejectionReason: saved.rejectionReason,
        createdAt: saved.createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        paidAt: saved.paidAt?.toISOString() ?? null,
        completedAt: saved.completedAt?.toISOString() ?? null,
        history,
        permittedActions,
      },
    };
  }
}
