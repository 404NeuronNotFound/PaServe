import { parseReceiptShopDetails } from '@paserve/contracts';
import { BadRequestException } from '@nestjs/common';

/** Missing legacy snapshots stay missing; never substitute today's contact details. */
export function readReceiptShopDetails(value: unknown) {
  if (value == null) return null;
  const details = parseReceiptShopDetails(value);
  if (!details)
    throw new BadRequestException({
      code: 'RECEIPT_SHOP_DETAILS_UNAVAILABLE',
      message: 'Unable to read the saved receipt shop details.',
    });
  return details;
}
