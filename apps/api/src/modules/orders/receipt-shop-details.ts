import { parseReceiptShopDetails } from '@paserve/contracts';

/** Missing legacy snapshots stay missing; never substitute today's contact details. */
export function readReceiptShopDetails(value: unknown) {
  if (value == null) return null;
  const details = parseReceiptShopDetails(value);
  if (!details) throw new Error('Invalid saved receipt shop details.');
  return details;
}
