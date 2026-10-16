import type { ReceiptShopDetails as ShopDetails } from "@paserve/contracts";
import "./receipt-shop-details.css";

/** Plain text keeps saved contact values readable without introducing external navigation. */
export function ReceiptShopDetails({ details }: { details?: ShopDetails | null }) {
  if (!details) return null;
  return (
    <section className="receipt-shop-details" aria-label="Shop details">
      <h2>{details.name}</h2>
      {details.address && <p className="receipt-shop-address">{details.address}</p>}
      <dl>
        {details.phone && <div><dt>Phone</dt><dd>{details.phone}</dd></div>}
        {details.contactEmail && <div><dt>Email</dt><dd>{details.contactEmail}</dd></div>}
        {details.website && <div><dt>Website</dt><dd>{details.website}</dd></div>}
      </dl>
    </section>
  );
}
