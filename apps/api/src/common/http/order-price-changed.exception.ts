import { ConflictException } from '@nestjs/common';
import type { OrderPriceChange } from '@paserve/contracts';

/** Only this explicitly public exception may expose the customer's repriced lines. */
export class OrderPriceChangedException extends ConflictException {
  constructor(readonly priceChange: OrderPriceChange) {
    super({ code: 'ORDER_PRICE_CHANGED', message: 'Prices changed. Review the updated total before placing your order again.' });
  }
}
